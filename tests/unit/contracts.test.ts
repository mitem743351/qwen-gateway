import { describe, it, expect } from 'vitest';
import type {
  ChatRequest,
  CompletionResult,
  ModelInfo,
  NormalEvent,
  UsageInfo,
} from '../../src/types/contracts.js';
import type {
  OpenAIChatCompletion,
  OpenAIChatCompletionChunk,
} from '../../src/types/openai.js';
import type {
  ChatCompletionsBody,
  ChatsNewBody,
} from '../../src/types/qwen.js';

describe('Contracts & Interfaces (plan.md §8)', () => {
  it('instantiates valid ChatRequest shapes', () => {
    const req: ChatRequest = {
      model: 'qwen3.7-plus',
      messages: [{ role: 'user', content: 'Hello, Qwen!' }],
      reasoningEffort: 'medium',
    };
    expect(req.model).toBe('qwen3.7-plus');
    expect(req.reasoningEffort).toBe('medium');
    expect(req.messages).toHaveLength(1);
  });

  it('verifies NormalEvent discriminated union types', () => {
    const createdEvent: NormalEvent = {
      type: 'created',
      chatId: 'chat-uuid-123',
      responseId: 'resp-uuid-456',
    };
    const reasoningEvent: NormalEvent = {
      type: 'reasoning',
      text: 'Analyzing the query step by step...',
      title: 'Thinking Process',
    };
    const contentEvent: NormalEvent = {
      type: 'content',
      text: 'Here is the answer.',
    };
    const toolEvent: NormalEvent = {
      type: 'tool',
      name: 'code_interpreter',
      status: 'running',
      functionId: 'func-789',
      arguments: { code: 'print(42)' },
    };
    const usage: UsageInfo = {
      inputTokens: 15,
      outputTokens: 40,
      totalTokens: 55,
      reasoningTokens: 25,
    };
    const usageEvent: NormalEvent = { type: 'usage', usage };
    const finishedEvent: NormalEvent = { type: 'finished', finishReason: 'stop' };

    expect(createdEvent.type).toBe('created');
    expect(reasoningEvent.type).toBe('reasoning');
    expect(contentEvent.type).toBe('content');
    expect(toolEvent.type).toBe('tool');
    expect(usageEvent.type).toBe('usage');
    expect(finishedEvent.type).toBe('finished');
  });

  it('validates CompletionResult structure', () => {
    const result: CompletionResult = {
      content: '42',
      reasoning: 'The ultimate question...',
      usage: {
        inputTokens: 10,
        outputTokens: 15,
        totalTokens: 25,
      },
      finishReason: 'stop',
    };
    expect(result.content).toBe('42');
    expect(result.finishReason).toBe('stop');
  });

  it('validates ModelInfo contract mapping', () => {
    const model: ModelInfo = {
      id: 'qwen3.7-plus',
      displayName: 'Qwen3.7-Plus',
      contextWindow: 1000000,
      maxOutputTokens: 65536,
      capabilities: {
        vision: true,
        documents: true,
        videoInput: false,
        audioInput: true,
        reasoning: true,
        thinkSkip: true,
        webSearch: true,
        imageGeneration: true,
        tools: true,
        mcp: true,
      },
      chatTypes: ['t2t', 't2i'],
      source: 'snapshot',
      confidence: 'confirmed',
    };
    expect(model.contextWindow).toBe(1000000);
    expect(model.capabilities.reasoning).toBe(true);
  });

  it('validates OpenAI wire types compatibility', () => {
    const chunk: OpenAIChatCompletionChunk = {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: 1777528203,
      model: 'qwen3.7-plus',
      choices: [
        {
          index: 0,
          delta: { content: 'Hello' },
          finish_reason: null,
        },
      ],
    };
    expect(chunk.object).toBe('chat.completion.chunk');

    const completion: OpenAIChatCompletion = {
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: 1777528203,
      model: 'qwen3.7-plus',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'Hello' },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 5,
        total_tokens: 15,
      },
    };
    expect(completion.object).toBe('chat.completion');
  });

  it('validates Upstream Qwen wire types', () => {
    const newChat: ChatsNewBody = {
      chatId: '',
      models: ['qwen3.7-plus'],
      project_id: '',
      timestamp: Date.now(),
      chat_type: 't2t',
      chat_mode: 'normal',
    };
    expect(newChat.chat_mode).toBe('normal');

    const compBody: ChatCompletionsBody = {
      stream: true,
      version: '2.1',
      incremental_output: true,
      chatId: 'test-chat',
      chat_id: 'test-chat',
      chat_mode: 'normal',
      model: 'qwen3.7-plus',
      messages: [
        {
          fid: 'msg-1',
          role: 'user',
          content: 'Hi',
          chat_type: 't2t',
          model: 'qwen3.7-plus',
          status: 'completed',
          contentType: 'text',
        },
      ],
      timestamp: Date.now(),
    };
    expect(compBody.version).toBe('2.1');
    expect(compBody.messages[0]?.content).toBe('Hi');
  });
});
