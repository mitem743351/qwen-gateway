/**
 * src/services/transport/transport-router.ts
 *
 * Routes upstream chat completion requests through direct HTTP (fetch)
 * or CloakBrowser page context evaluation as fallback.
 * Supports mock transport for local offline execution and test suites.
 */

import { COMMON_UPSTREAM_HEADERS, UPSTREAM_ENDPOINTS } from '../upstream-constants.js';
import type { ChatRequest, NormalEvent } from '../../types/contracts.js';
import { buildChatsNewPayload, buildChatCompletionsPayload } from '../protocol/payload-builder.js';
import { QwenSseParser } from '../protocol/sse-parser.js';
import { classifyError } from '../protocol/error-classifier.js';
import type { SessionService } from '../session/session-service.js';
import type { TokenService } from '../token/token-service.js';

export interface TransportOptions {
  mode?: 'live' | 'mock';
  sessionService?: SessionService;
  tokenService?: TokenService;
  customFetch?: typeof fetch;
}

export class TransportRouter {
  private readonly mode: 'live' | 'mock';
  private readonly sessionService: SessionService | undefined;
  private readonly tokenService: TokenService | undefined;
  private readonly doFetch: typeof fetch;

  constructor(options: TransportOptions = {}) {
    this.mode =
      options.mode ??
      ((process.env['QWEN_TRANSPORT'] as 'live' | 'mock') || 'live');
    this.sessionService = options.sessionService;
    this.tokenService = options.tokenService;
    this.doFetch = options.customFetch ?? fetch;
  }

  /**
   * Executes a streaming chat request.
   */
  public async executeStream(
    req: ChatRequest,
    accountId: string,
    onEvent: (event: NormalEvent) => void,
  ): Promise<void> {
    if (this.mode === 'mock') {
      return this.executeMockStream(req, onEvent);
    }

    return this.executeHttpStream(req, accountId, onEvent);
  }

  private async executeHttpStream(
    req: ChatRequest,
    accountId: string,
    onEvent: (event: NormalEvent) => void,
  ): Promise<void> {
    const cookieHeader = this.sessionService?.getCookieHeader(accountId) || '';
    const baxiaHeaders =
      this.tokenService?.getHeaders(accountId) ||
      this.tokenService?.getSyntheticTokens(accountId) ||
      {};

    const headers: Record<string, string> = {
      ...COMMON_UPSTREAM_HEADERS,
      'Content-Type': 'application/json',
      ...baxiaHeaders,
    };
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    // Step 1: Create conversation via POST /api/v2/chats/new
    const chatsNewBody = buildChatsNewPayload(req.model);
    const newChatRes = await this.doFetch(UPSTREAM_ENDPOINTS.chatsNew, {
      method: 'POST',
      headers,
      body: JSON.stringify(chatsNewBody),
    });

    if (!newChatRes.ok) {
      const errText = await newChatRes.text();
      const err = classifyError(newChatRes.status, errText);
      onEvent({ type: 'error', error: err });
      throw new Error(`Failed to create conversation: ${err.message}`);
    }

    const newChatJson = (await newChatRes.json()) as {
      success?: boolean;
      data?: { id?: string };
    };
    const chatId = newChatJson.data?.id || `chat-${Date.now()}`;

    // Step 2: Stream completion via POST /api/v2/chat/completions?chat_id={id}
    const compBody = buildChatCompletionsPayload(req, chatId);
    const compUrl = `${UPSTREAM_ENDPOINTS.chatCompletions}?chat_id=${encodeURIComponent(chatId)}`;

    const compRes = await this.doFetch(compUrl, {
      method: 'POST',
      headers: {
        ...headers,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(compBody),
    });

    if (!compRes.ok) {
      const errText = await compRes.text();
      const err = classifyError(compRes.status, errText);
      onEvent({ type: 'error', error: err });
      throw new Error(`Upstream completion failed: ${err.message}`);
    }

    if (!compRes.body) {
      throw new Error('Upstream response body is null');
    }

    const parser = new QwenSseParser({ onEvent });
    const reader = compRes.body.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value, { stream: true });
        parser.feed(text);
      }
      parser.flush();
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Generates realistic simulated stream events for offline test execution.
   */
  private async executeMockStream(
    req: ChatRequest,
    onEvent: (event: NormalEvent) => void,
  ): Promise<void> {
    const chatId = `mock-chat-${Date.now()}`;
    const respId = `mock-resp-${Date.now()}`;

    // 1. response.created
    onEvent({ type: 'created', chatId, responseId: respId });
    await new Promise((r) => setTimeout(r, 10));

    // 2. thinking phase (if reasoning not explicitly disabled)
    if (req.reasoningEffort !== 'none') {
      onEvent({
        type: 'reasoning',
        text: 'Examining the question and constructing a thoughtful reply.',
        title: 'Thinking Process',
      });
      await new Promise((r) => setTimeout(r, 10));
    }

    // 3. answer phase
    const userMsg =
      req.messages[req.messages.length - 1]?.content || 'Hello from Qwen Gateway!';
    const userText = typeof userMsg === 'string' ? userMsg : 'Multimodal query';
    const answer = `[Mock Qwen Response] Processed request with model ${req.model}: "${userText.slice(0, 30)}"`;

    // Stream answer in chunks
    const words = answer.split(' ');
    for (let i = 0; i < words.length; i++) {
      const chunk = (i > 0 ? ' ' : '') + words[i];
      onEvent({ type: 'content', text: chunk });
    }

    // 4. usage
    onEvent({
      type: 'usage',
      usage: {
        inputTokens: 18,
        outputTokens: 24,
        totalTokens: 42,
        reasoningTokens: req.reasoningEffort !== 'none' ? 10 : 0,
      },
    });

    // 5. finished
    onEvent({ type: 'finished', finishReason: 'stop' });
  }
}
