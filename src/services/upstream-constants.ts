/**
 * src/services/upstream-constants.ts
 *
 * Upstream endpoints, headers, retry budget caps, and protocol constants.
 * Grounded strictly in plan.md §4, §4.9, and Research.md.
 */

export const UPSTREAM_BASE_URL =
  process.env['QWEN_BASE_URL'] || 'https://chat.qwen.ai';

export const UPSTREAM_ENDPOINTS = {
  chatsNew: `${UPSTREAM_BASE_URL}/api/v2/chats/new`,
  chatCompletions: `${UPSTREAM_BASE_URL}/api/v2/chat/completions`,
  chatStop: `${UPSTREAM_BASE_URL}/api/v2/chat/completions/stop`,
  models: `${UPSTREAM_BASE_URL}/api/v2/models/`,
  auths: `${UPSTREAM_BASE_URL}/api/v1/auths/`,
  usersStatus: `${UPSTREAM_BASE_URL}/api/v2/users/status`,
  getstsToken: `${UPSTREAM_BASE_URL}/api/v2/files/getstsToken`,
} as const;

/**
 * Standard headers required for all upstream calls.
 * Realistic Chrome User-Agent and origin bindings.
 */
export const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.7680.177 Safari/537.36';

export const COMMON_UPSTREAM_HEADERS: Record<string, string> = {
  'User-Agent': DEFAULT_USER_AGENT,
  'Accept-Language': 'en-US,en;q=0.9',
  source: 'web',
  Origin: 'https://chat.qwen.ai',
  Referer: 'https://chat.qwen.ai/',
};

/**
 * Outbound version request header policy (plan.md §4, §10, §11.2):
 * Value is UNKNOWN [FE]. There is no captured outbound evidence for any specific version header.
 * Policy: Omit until captured live from an authentic browser request.
 */
export const CAPTURED_VERSION_HEADER: string | undefined = undefined;

/**
 * Request-level retry budget caps (plan.md §4.9).
 * Prevents retry storms under upstream outages or rate-limiting.
 */
export const RETRY_BUDGET_CONFIG = {
  maxAttempts: Number.parseInt(process.env['MAX_RETRY_ATTEMPTS'] || '4', 10),
  maxRotations: Number.parseInt(process.env['MAX_ACCOUNT_ROTATIONS'] || '2', 10),
  maxBrowserFallbacks: Number.parseInt(
    process.env['MAX_BROWSER_FALLBACKS'] || '1',
    10,
  ),
  maxRetryDurationSec: Number.parseInt(
    process.env['MAX_RETRY_DURATION_SEC'] || '60',
    10,
  ),
  baseDelayMs: 500,
  maxDelayMs: 4000,
} as const;

export const DEFAULT_MODEL_ID =
  process.env['DEFAULT_MODEL'] || 'qwen3.7-plus';
