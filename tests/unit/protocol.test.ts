import { describe, it, expect } from 'vitest';
import { buildChatCompletionsPayload, buildChatsNewPayload } from '../../src/services/protocol/payload-builder.js';
import { QwenSseParser } from '../../src/services/protocol/sse-parser.js';
import { classifyError } from '../../src/services/protocol/error-classifier.js';
import { RequestRetryBudget } from '../../src/services/retry.js';
import { ModelRegistry } from '../../src/services/model-registry.js';
import type { NormalEvent } from '../../src/types/contracts.js';

describe('Qwen Protocol & Payload Builders (Research §5–§7)', () => {
  it('builds valid ChatsNew payload with researched schema', () => {
    const payload = buildChatsNewPayload('qwen3.7-plus') as Record<string, unknown>;
    expect(payload['chatId']).toBe('');
    expect(payload['chat_mode']).toBe('normal');
    expect(payload['models']).toEqual(['qwen3.7-plus']);
    expect(payload['chat_type']).toBe('t2t');
  });

  it('builds valid ChatCompletions payload with dual chatId/chat_id keys', () => {
    const payload = buildChatCompletionsPayload(
      {
        model: 'qwen3.7-plus',
        messages: [{ role: 'user', content: 'What is 2+2?' }],
        reasoningEffort: 'high',
      },
      'chat-uuid-12345',
    );

    expect(payload.chatId).toBe('chat-uuid-12345');
    expect(payload.chat_id).toBe('chat-uuid-12345');
    expect(payload.version).toBe('2.1');
    expect(payload.stream).toBe(true);
    expect(payload.incremental_output).toBe(true);
    expect(payload.messages).toHaveLength(1);

    const userMsg = payload.messages[0];
    expect(userMsg?.role).toBe('user');
    expect(userMsg?.user_action).toBe('chat');
    expect(userMsg?.feature_config?.thinking_mode).toBe('Thinking');
    expect(userMsg?.feature_config?.auto_search).toBe(false);
  });
});

describe('Qwen SSE Parser (Line-buffered & Phase Routing)', () => {
  it('parses response.created, reasoning, answer, usage, and finish frames', () => {
    const events: NormalEvent[] = [];
    const parser = new QwenSseParser({
      onEvent: (evt) => events.push(evt),
    });

    const rawStream = [
      'data: {"response.created":{"chat_id":"c123","response_id":"r456"}}\n\n',
      'data: {"choices":[{"delta":{"phase":"thinking_summary","extra":{"summary_thought":{"content":["Thinking step 1... "]},"summary_title":{"content":["Analysis"]}}}}],"usage":{"input_tokens":10,"output_tokens":5,"total_tokens":15}}\n\n',
      'data: {"choices":[{"delta":{"phase":"thinking_summary","extra":{"summary_thought":{"content":["Step 2..."]}}}}]}\n\n',
      'data: {"choices":[{"delta":{"phase":"answer","content":"Hello "}}]}\n\n',
      'data: {"choices":[{"delta":{"phase":"answer","content":"world!"}}]}\n\n',
      'data: {"choices":[{"delta":{"phase":"code_interpreter","function_id":"fn-1","function_call":{"name":"py","arguments":"print(1)"},"status":"running"}}]}\n\n',
      'data: {"choices":[{"delta":{"status":"finished"}}],"usage":{"input_tokens":10,"output_tokens":25,"total_tokens":35,"output_tokens_details":{"reasoning_tokens":12,"text_tokens":13}}}\n\n',
      'data: [DONE]\n\n',
    ].join('');

    // Feed in small arbitrary chunks to test line buffering & fragmentation
    const chunkSize = 37;
    for (let i = 0; i < rawStream.length; i += chunkSize) {
      parser.feed(rawStream.slice(i, i + chunkSize));
    }
    parser.flush();

    expect(events.some((e) => e.type === 'created')).toBe(true);
    expect(events.some((e) => e.type === 'reasoning')).toBe(true);
    expect(events.some((e) => e.type === 'content')).toBe(true);
    expect(events.some((e) => e.type === 'tool')).toBe(true);
    expect(events.some((e) => e.type === 'usage')).toBe(true);
    expect(events.some((e) => e.type === 'finished')).toBe(true);

    const toolEvt = events.find((e) => e.type === 'tool');
    expect(toolEvt?.type === 'tool' && toolEvt.name).toBe('py');

    const lastUsage = parser.getLastUsage();
    expect(lastUsage?.totalTokens).toBe(35);
    expect(lastUsage?.reasoningTokens).toBe(12);
  });
});

describe('Error Classifier (plan.md §4.8)', () => {
  it('classifies 429 as rate_limit', () => {
    const err = classifyError(429, 'Too many requests');
    expect(err.kind).toBe('rate_limit');
  });

  it('classifies Baxia captcha and rgv587 as captcha challenge', () => {
    const err = classifyError(200, JSON.stringify({ code: 'FAIL_SYS_USER_VALIDATE' }));
    expect(err.kind).toBe('captcha');
  });

  it('classifies 401 as auth error', () => {
    const err = classifyError(401, 'Unauthorized');
    expect(err.kind).toBe('auth');
  });

  it('classifies WAF html response as waf', () => {
    const err = classifyError(403, '<html><body>aliyun_waf block</body></html>');
    expect(err.kind).toBe('waf');
  });
});

describe('Request Retry Budget (plan.md §4.9)', () => {
  it('enforces hard budget caps (<=4 attempts, <=2 rotations, <=1 browser fallback)', () => {
    const attemptBudget = new RequestRetryBudget({ maxAttempts: 4 });
    expect(attemptBudget.recordAttempt()).toBe(true); // Attempt 1
    expect(attemptBudget.recordAttempt()).toBe(true); // Attempt 2
    expect(attemptBudget.recordAttempt()).toBe(true); // Attempt 3
    expect(attemptBudget.recordAttempt()).toBe(true); // Attempt 4
    expect(attemptBudget.recordAttempt()).toBe(false); // Attempt 5 rejected

    const rotationBudget = new RequestRetryBudget({ maxRotations: 2 });
    expect(rotationBudget.recordRotation()).toBe(true); // Rotation 1
    expect(rotationBudget.recordRotation()).toBe(true); // Rotation 2
    expect(rotationBudget.recordRotation()).toBe(false); // Rotation 3 rejected

    const fallbackBudget = new RequestRetryBudget({ maxBrowserFallbacks: 1 });
    expect(fallbackBudget.recordBrowserFallback()).toBe(true); // Fallback 1
    expect(fallbackBudget.recordBrowserFallback()).toBe(false); // Fallback 2 rejected
  });
});

describe('ModelRegistry Drift & Registration Policy (plan.md §5)', () => {
  it('loads snapshot and exposes OpenAI list format', () => {
    const registry = new ModelRegistry();
    const models = registry.listModels();
    expect(models.length).toBeGreaterThanOrEqual(6);

    const openaiList = registry.toOpenAIList();
    expect(openaiList.object).toBe('list');
    expect(openaiList.data.some((m) => m.id === 'qwen3.7-plus')).toBe(true);
  });

  it('rejects unknown models by default unless ALLOW_UNKNOWN_MODELS is true', () => {
    const strictRegistry = new ModelRegistry({ allowUnknownModels: false });
    expect(strictRegistry.getModel('non-existent-model')).toBeUndefined();

    const permissiveRegistry = new ModelRegistry({ allowUnknownModels: true });
    const inferred = permissiveRegistry.getModel('newly-launched-model');
    expect(inferred).toBeDefined();
    expect(inferred?.confidence).toBe('inferred');
  });
});
