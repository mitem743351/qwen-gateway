/**
 * src/server/app.ts
 *
 * Hono application defining OpenAI-compatible endpoints:
 *   - POST /v1/chat/completions (stream and non-stream)
 *   - GET  /v1/models
 *   - POST /v1/images/generations
 *   - GET  /healthz
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ChatRequest, IncomingMessage } from '../types/contracts.js';
import type {
  OpenAIChatCompletion,
  OpenAIUsage,
} from '../types/openai.js';
import { DefaultQwenClient } from '../services/qwen-client.js';
import { authMiddleware } from './auth-middleware.js';
import { OpenAISseWriter } from './sse-writer.js';

export interface AppOptions {
  client?: DefaultQwenClient;
}

export function createApp(options: AppOptions = {}): Hono {
  const app = new Hono();
  const client = options.client ?? new DefaultQwenClient();

  // Middleware
  app.use('*', cors());
  app.use('*', authMiddleware);

  // Health check endpoint
  app.get('/healthz', (c) => {
    const registry = client.getRegistry();
    const pool = client.getAccountPool();

    return c.json({
      status: 'ok',
      registry_drift: registry.hasDrift(),
      pool_status: pool.status(),
    });
  });

  // Models listing
  app.get('/v1/models', (c) => {
    const registry = client.getRegistry();
    return c.json(registry.toOpenAIList());
  });

  // Chat completion schema
  const messagePartSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string() }),
    z.object({
      type: z.literal('image_url'),
      image_url: z.object({ url: z.string() }),
    }),
  ]);

  const messageSchema = z.object({
    role: z.enum(['system', 'user', 'assistant', 'tool']),
    content: z.union([z.string(), z.array(messagePartSchema)]),
    name: z.string().optional(),
  });

  const chatCompletionSchema = z.object({
    model: z.string(),
    messages: z.array(messageSchema).min(1),
    stream: z.boolean().optional().default(false),
    reasoning_effort: z
      .enum(['none', 'minimal', 'low', 'medium', 'high'])
      .optional(),
    temperature: z.number().optional(),
    top_p: z.number().optional(),
    max_tokens: z.number().optional(),
  });

  // Chat completion endpoint
  app.post('/v1/chat/completions', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json(
        {
          error: {
            message: 'Invalid JSON request body.',
            type: 'invalid_request_error',
            code: 'invalid_json',
          },
        },
        400,
      );
    }

    const parseResult = chatCompletionSchema.safeParse(body);
    if (!parseResult.success) {
      return c.json(
        {
          error: {
            message: parseResult.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('; '),
            type: 'invalid_request_error',
            code: 'bad_request',
          },
        },
        400,
      );
    }

    const reqData = parseResult.data;

    // 1. Text-only enforcement for v1 (plan §7 Phase 4)
    for (const msg of reqData.messages) {
      if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'image_url') {
            return c.json(
              {
                error: {
                  message:
                    'Image inputs are not supported in v1. Multimodal support is scheduled for phase P2-B.',
                  type: 'invalid_request_error',
                  code: 'unsupported_feature',
                },
              },
              400,
            );
          }
        }
      }
    }

    // 2. Model verification per §5.3
    const registry = client.getRegistry();
    const modelInfo = registry.getModel(reqData.model);
    if (!modelInfo) {
      return c.json(
        {
          error: {
            message: `Model '${reqData.model}' not found in registry.`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        },
        404,
      );
    }

    // 3. Map reasoning effort (with 'minimal' -> 'low' alias)
    let reasoningEffort: ChatRequest['reasoningEffort'];
    if (reqData.reasoning_effort === 'minimal') {
      reasoningEffort = 'low';
    } else if (reqData.reasoning_effort) {
      reasoningEffort = reqData.reasoning_effort;
    }

    // Normalize incoming messages
    const incomingMessages: IncomingMessage[] = reqData.messages.map((m) => ({
      role: m.role === 'tool' ? 'assistant' : m.role,
      content: typeof m.content === 'string' ? m.content : m.content,
    }));

    const chatReq: ChatRequest = {
      model: reqData.model,
      messages: incomingMessages,
      signal: c.req.raw.signal,
    };
    if (reasoningEffort) {
      chatReq.reasoningEffort = reasoningEffort;
    }

    // 4. Handle streaming mode
    if (reqData.stream) {
      return streamSSE(c, async (stream) => {
        const sseWriter = new OpenAISseWriter({
          model: reqData.model,
          writeRaw: async (data: string) => {
            await stream.write(data);
          },
        });

        try {
          await client.chatStream(chatReq, async (event) => {
            await sseWriter.sendEvent(event);
          });
          await sseWriter.finish();
        } catch (err: unknown) {
          const message =
            err instanceof Error ? err.message : 'Internal streaming error';
          await stream.write(
            `data: ${JSON.stringify({
              error: {
                message,
                type: 'upstream_error',
                code: 'stream_error',
              },
            })}\n\n`,
          );
        }
      });
    }

    // 5. Handle non-streaming mode (local aggregation of SSE chunks)
    try {
      const result = await client.chatStream(chatReq, () => {});
      const completionId = `chatcmpl-${randomUUID()}`;
      const created = Math.floor(Date.now() / 1000);

      const usage: OpenAIUsage = {
        prompt_tokens: result.usage?.inputTokens ?? 0,
        completion_tokens: result.usage?.outputTokens ?? 0,
        total_tokens: result.usage?.totalTokens ?? 0,
      };
      if (result.usage?.reasoningTokens !== undefined) {
        usage.completion_tokens_details = {
          reasoning_tokens: result.usage.reasoningTokens,
        };
      }
      if (result.usage?.cachedTokens !== undefined) {
        usage.prompt_tokens_details = {
          cached_tokens: result.usage.cachedTokens,
        };
      }

      const responseBody: OpenAIChatCompletion = {
        id: completionId,
        object: 'chat.completion',
        created,
        model: reqData.model,
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: result.content,
              reasoning_content: result.reasoning || null,
            },
            finish_reason: result.finishReason === 'length' ? 'length' : 'stop',
          },
        ],
        usage,
      };

      return c.json(responseBody);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Chat completion failed';
      return c.json(
        {
          error: {
            message,
            type: 'upstream_error',
            code: 'completion_failed',
          },
        },
        500,
      );
    }
  });

  // Image generation endpoint
  app.post('/v1/images/generations', async (c) => {
    const transportMode = process.env['QWEN_TRANSPORT'] || 'live';
    if (transportMode !== 'mock') {
      // In live mode, image generation is probe-gated per plan §6 and §11.4
      return c.json(
        {
          error: {
            message:
              'Image generation (t2i) is not currently enabled. Requires probe verification.',
            type: 'not_implemented',
            code: 'feature_gated',
          },
        },
        501,
      );
    }

    try {
      const body = (await c.req.json()) as { prompt?: string; n?: number };
      if (!body.prompt) {
        return c.json(
          {
            error: {
              message: 'Prompt is required for image generation.',
              type: 'invalid_request_error',
              code: 'missing_prompt',
            },
          },
          400,
        );
      }

      const res = await client.generateImages({
        prompt: body.prompt,
        n: body.n ?? 1,
      });

      return c.json({
        created: Math.floor(Date.now() / 1000),
        data: res.urls.map((url) => ({ url })),
      });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Image generation failed';
      return c.json(
        {
          error: {
            message,
            type: 'upstream_error',
            code: 'generation_failed',
          },
        },
        500,
      );
    }
  });

  return app;
}
