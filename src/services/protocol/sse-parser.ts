/**
 * src/services/protocol/sse-parser.ts
 *
 * Line-buffered, partial-safe SSE parser for upstream chat.qwen.ai streams.
 * Transforms raw SSE text frames into normalized `NormalEvent` objects.
 */

import type {
  GatewayError,
  NormalEvent,
  UsageInfo,
} from '../../types/contracts.js';
import type { WireUsage } from '../../types/qwen.js';

export interface SseParserCallbacks {
  onEvent: (event: NormalEvent) => void;
  onError?: (err: GatewayError) => void;
}

export class QwenSseParser {
  private buffer = '';
  private lastUsage: UsageInfo | undefined;
  private readonly onEvent: (event: NormalEvent) => void;

  constructor(callbacks: SseParserCallbacks) {
    this.onEvent = callbacks.onEvent;
  }

  /**
   * Feeds a chunk of incoming text (possibly fragmented) into the buffer.
   */
  public feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    // Keep the trailing uncompleted line in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      this.parseLine(line.trim());
    }
  }

  /**
   * Flushes any remaining bytes in the buffer upon stream close.
   */
  public flush(): void {
    if (this.buffer.trim().length > 0) {
      this.parseLine(this.buffer.trim());
      this.buffer = '';
    }
  }

  private parseLine(line: string): void {
    if (!line || line.startsWith(':')) {
      // SSE comment / heartbeat
      return;
    }

    if (line === 'data: [DONE]') {
      this.onEvent({ type: 'finished', finishReason: 'stop' });
      return;
    }

    if (!line.startsWith('data:')) {
      return;
    }

    const payload = line.slice(5).trim();
    if (!payload) return;

    try {
      const data = JSON.parse(payload);
      this.handleParsedData(data);
    } catch {
      // Ignore unparseable frames (or partial JSON) gracefully
    }
  }

  private handleParsedData(data: Record<string, unknown>): void {
    // 1. Check for response.created event
    if (
      typeof data['response.created'] === 'object' &&
      data['response.created'] !== null
    ) {
      const rc = data['response.created'] as Record<string, unknown>;
      const chatId = String(rc['chat_id'] ?? '');
      const responseId = rc['response_id']
        ? String(rc['response_id'])
        : undefined;
      const event: NormalEvent = responseId !== undefined
        ? { type: 'created', chatId, responseId }
        : { type: 'created', chatId };
      this.onEvent(event);
      return;
    }

    // 2. Extract cumulative in-stream usage if present
    if (typeof data['usage'] === 'object' && data['usage'] !== null) {
      const u = data['usage'] as WireUsage;
      const usageInfo: UsageInfo = {
        inputTokens: u.input_tokens ?? 0,
        outputTokens: u.output_tokens ?? 0,
        totalTokens: u.total_tokens ?? 0,
      };
      if (u.output_tokens_details?.text_tokens !== undefined) {
        usageInfo.outputTextTokens = u.output_tokens_details.text_tokens;
      }
      if (u.output_tokens_details?.reasoning_tokens !== undefined) {
        usageInfo.reasoningTokens = u.output_tokens_details.reasoning_tokens;
      }
      if (u.prompt_tokens_details?.cached_tokens !== undefined) {
        usageInfo.cachedTokens = u.prompt_tokens_details.cached_tokens;
      }

      this.lastUsage = usageInfo;
      this.onEvent({ type: 'usage', usage: usageInfo });
    }

    // 3. Inspect choices array
    if (Array.isArray(data['choices'])) {
      for (const choice of data['choices']) {
        if (!choice || typeof choice !== 'object') continue;
        const delta = choice.delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        const phase = typeof delta['phase'] === 'string' ? delta['phase'] : '';
        const status =
          typeof delta['status'] === 'string' ? delta['status'] : '';

        // Reasoning phase: delta.phase === "thinking_summary"
        if (phase === 'thinking_summary') {
          const extra = delta['extra'] as Record<string, unknown> | undefined;
          let text = '';
          let title: string | undefined;

          if (extra) {
            const thoughtObj = extra['summary_thought'] as
              | { content?: string[] }
              | undefined;
            if (Array.isArray(thoughtObj?.content)) {
              text = thoughtObj.content.join('');
            } else if (typeof thoughtObj?.content === 'string') {
              text = thoughtObj.content;
            }

            const titleObj = extra['summary_title'] as
              | { content?: string[] }
              | undefined;
            if (Array.isArray(titleObj?.content)) {
              title = titleObj.content.join('');
            } else if (typeof titleObj?.content === 'string') {
              title = titleObj.content;
            }
          }

          // Also check direct delta.content if thought wasn't in extra
          if (!text && typeof delta['content'] === 'string') {
            text = delta['content'];
          }

          if (text || title) {
            const event: NormalEvent = title !== undefined
              ? { type: 'reasoning', text, title }
              : { type: 'reasoning', text };
            this.onEvent(event);
          }
        } else if (phase === 'answer') {
          // Content phase: delta.phase === "answer"
          const text =
            typeof delta['content'] === 'string' ? delta['content'] : '';
          if (text) {
            this.onEvent({ type: 'content', text });
          }
        } else if (phase) {
          // Tool or other phases: preserve verbatim and do not crash
          const funcCall = delta['function_call'] as
            | { name?: string; arguments?: unknown }
            | undefined;
          const funcName = funcCall?.name || phase;
          const funcId =
            typeof delta['function_id'] === 'string'
              ? delta['function_id']
              : undefined;
          const args = funcCall?.arguments;

          const toolEvt: NormalEvent = {
            type: 'tool',
            name: funcName,
            status: status || 'running',
          };
          if (funcId !== undefined) {
            toolEvt.functionId = funcId;
          }
          if (args !== undefined) {
            toolEvt.arguments = args;
          }
          this.onEvent(toolEvt);
        } else if (typeof delta['content'] === 'string' && delta['content']) {
          // Default content fallback if phase is omitted
          this.onEvent({ type: 'content', text: delta['content'] });
        }

        // Completion status
        if (status === 'finished') {
          this.onEvent({ type: 'finished', finishReason: 'stop' });
        }
      }
    }
  }

  public getLastUsage(): UsageInfo | undefined {
    return this.lastUsage;
  }
}
