/**
 * src/server/sse-writer.ts
 *
 * Writes OpenAI-compatible Server-Sent Events (SSE) from normalized `NormalEvent`s.
 */

import { randomUUID } from 'node:crypto';
import type { NormalEvent, UsageInfo } from '../types/contracts.js';
import type {
  OpenAIChatCompletionChunk,
  OpenAIUsage,
} from '../types/openai.js';

export interface SseWriterContext {
  model: string;
  writeRaw: (data: string) => Promise<void>;
}

export class OpenAISseWriter {
  private readonly completionId: string;
  private readonly created: number;
  private readonly model: string;
  private readonly writeRaw: (data: string) => Promise<void>;
  private lastUsage: UsageInfo | undefined;
  private emittedTitle = false;

  constructor(ctx: SseWriterContext) {
    this.completionId = `chatcmpl-${randomUUID()}`;
    this.created = Math.floor(Date.now() / 1000);
    this.model = ctx.model;
    this.writeRaw = ctx.writeRaw;
  }

  public async sendEvent(event: NormalEvent): Promise<void> {
    if (event.type === 'reasoning') {
      let reasoningDelta = '';
      if (event.title && !this.emittedTitle) {
        reasoningDelta += `### ${event.title}\n`;
        this.emittedTitle = true;
      }
      reasoningDelta += event.text;

      const chunk: OpenAIChatCompletionChunk = {
        id: this.completionId,
        object: 'chat.completion.chunk',
        created: this.created,
        model: this.model,
        choices: [
          {
            index: 0,
            delta: { reasoning_content: reasoningDelta },
            finish_reason: null,
          },
        ],
      };
      await this.writeChunk(chunk);
    } else if (event.type === 'content') {
      const chunk: OpenAIChatCompletionChunk = {
        id: this.completionId,
        object: 'chat.completion.chunk',
        created: this.created,
        model: this.model,
        choices: [
          {
            index: 0,
            delta: { content: event.text },
            finish_reason: null,
          },
        ],
      };
      await this.writeChunk(chunk);
    } else if (event.type === 'usage') {
      this.lastUsage = event.usage;
    } else if (event.type === 'finished') {
      // Send final finish_reason chunk
      const chunk: OpenAIChatCompletionChunk = {
        id: this.completionId,
        object: 'chat.completion.chunk',
        created: this.created,
        model: this.model,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: event.finishReason === 'stop' ? 'stop' : 'length',
          },
        ],
      };
      await this.writeChunk(chunk);
    }
  }

  public async finish(): Promise<void> {
    // If usage was captured, emit an OpenAI usage chunk before [DONE]
    if (this.lastUsage) {
      const openAiUsage: OpenAIUsage = {
        prompt_tokens: this.lastUsage.inputTokens,
        completion_tokens: this.lastUsage.outputTokens,
        total_tokens: this.lastUsage.totalTokens,
      };
      if (this.lastUsage.reasoningTokens !== undefined) {
        openAiUsage.completion_tokens_details = {
          reasoning_tokens: this.lastUsage.reasoningTokens,
        };
      }
      if (this.lastUsage.cachedTokens !== undefined) {
        openAiUsage.prompt_tokens_details = {
          cached_tokens: this.lastUsage.cachedTokens,
        };
      }

      const usageChunk: OpenAIChatCompletionChunk = {
        id: this.completionId,
        object: 'chat.completion.chunk',
        created: this.created,
        model: this.model,
        choices: [],
        usage: openAiUsage,
      };
      await this.writeChunk(usageChunk);
    }

    await this.writeRaw('data: [DONE]\n\n');
  }

  private async writeChunk(chunk: OpenAIChatCompletionChunk): Promise<void> {
    await this.writeRaw(`data: ${JSON.stringify(chunk)}\n\n`);
  }
}
