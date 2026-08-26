/**
 * src/types/contracts.ts
 *
 * Core shared contracts and data transfer objects for Project Qwen Gateway.
 * Defined verbatim from plan.md §8 (v2.1).
 *
 * Owned jointly; modifications require coordination notes and preserve evidence tagging.
 */

// ── Input ──
export type ChatRole = 'system' | 'user' | 'assistant';

export interface IncomingMessage {
  role: ChatRole;
  content:
    | string
    | Array<
        | { type: 'text'; text: string }
        | { type: 'image_url'; image_url: { url: string } }
      >;
} // image_url rejected at API edge until P2-B

export interface ChatRequest {
  messages: IncomingMessage[];
  model: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'; // → feature_config.thinking_mode / auto_thinking
  signal?: AbortSignal;
}

// ── Models (replaces bare-string lists) ──
export interface ModelCapabilities {
  vision: boolean;
  documents: boolean;
  videoInput: boolean;
  audioInput: boolean;
  reasoning: boolean;
  thinkSkip: boolean;
  webSearch: boolean;
  imageGeneration: boolean;
  tools: boolean;
  mcp: boolean;
}

export interface ModelInfo {
  id: string; // upstream id, e.g. 'qwen3.7-plus'
  displayName: string; // 'Qwen3.7-Plus'
  contextWindow: number; // meta.max_context_length            [NET]
  maxOutputTokens: number; // max_summary_generation_length | max_generation_length [NET]
  maxThinkingTokens?: number; // max_thinking_generation_length when declared [NET]
  capabilities: ModelCapabilities;
  chatTypes: string[]; // ['t2t','t2i','search',…] from catalog
  source: 'live' | 'snapshot';
  confidence: 'confirmed' | 'frontend-only' | 'inferred';
}

// ── Normalized upstream events (replaces NormalDelta) ──
export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  outputTextTokens?: number;
  reasoningTokens?: number;
  cachedTokens?: number;
}

export interface GatewayError {
  message: string;
  code?: string;
  kind: 'rate_limit' | 'waf' | 'captcha' | 'upstream' | 'auth' | 'network';
}

export type NormalEvent =
  | { type: 'created'; chatId: string; responseId?: string }
  | { type: 'reasoning'; text: string; title?: string } // summary_thought + summary_title kept SEPARATE;
  // OpenAI adapter decides presentation
  | { type: 'content'; text: string } // phase === 'answer'
  | {
      type: 'tool';
      name: string;
      status: string;
      functionId?: string;
      arguments?: unknown;
    } // native tool phases preserved verbatim
  // (name/status/functionId/arguments); v1 logs only
  | { type: 'usage'; usage: UsageInfo } // cumulative — last one before finished wins
  | { type: 'finished'; finishReason: 'stop' | 'length' | 'aborted' }
  | { type: 'error'; error: GatewayError };

export interface CompletionResult {
  content: string;
  reasoning: string;
  usage?: UsageInfo; // real upstream counts [RUN]
  finishReason: 'stop' | 'length' | 'aborted' | 'error';
}

// ── Client & pool ──
// QwenClient is a thin façade. Internally it composes distinct concerns, each its own module:
//   QwenProtocol  — payload builders + SSE parsing + error classification (pure, unit-testable)
//   TransportRouter — http-first / browser-fallback decisioning per attempt
//   RetryPolicy   — the §4.9 request-level budget (attempts/rotations/fallbacks/duration)
//   SessionService, TokenService, ModelRegistry, AccountPool — as elsewhere in this plan
export type Transport = 'http' | 'browser';

export interface QwenClient {
  chatStream(
    req: ChatRequest,
    onEvent: (e: NormalEvent) => void,
  ): Promise<CompletionResult>;
  generateImages(req: {
    prompt: string;
    n?: number;
    size?: string;
    responseFormat?: 'url' | 'b64_json';
  }): Promise<{ urls: string[]; b64?: string[] }>;
  listModels(): Promise<ModelInfo[]>; // full metadata — callers map to OpenAI format
  refreshRegistry(): Promise<void>; // live /api/v2/models/ sync + drift diff
}

export interface Lease {
  release(): void;
}

export interface AccountPool {
  acquire(): Promise<Lease>;
  status(): Array<{
    label: string;
    status: string;
    cooldownUntil?: number;
    inflight: number;
  }>;
}
