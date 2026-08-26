/**
 * src/services/protocol/error-classifier.ts
 *
 * Classifies HTTP status codes, error payloads, and HTML challenge responses
 * into canonical `GatewayError` categories.
 */

import type { GatewayError } from '../../types/contracts.js';

export function classifyError(
  status: number,
  body?: string | Record<string, unknown>,
): GatewayError {
  const bodyText = typeof body === 'string' ? body : JSON.stringify(body || {});
  const bodyLower = bodyText.toLowerCase();

  // 1. Rate limiting
  if (
    status === 429 ||
    bodyLower.includes('too many requests') ||
    bodyLower.includes('rate_limit') ||
    bodyLower.includes('flow_limit')
  ) {
    return {
      kind: 'rate_limit',
      code: 'RATE_LIMITED',
      message: 'Upstream rate limit reached. Backing off.',
    };
  }

  // 2. WAF
  if (
    bodyLower.includes('aliyun_waf') ||
    (status === 403 && bodyLower.includes('waf')) ||
    (status === 403 && bodyLower.includes('forbidden'))
  ) {
    return {
      kind: 'waf',
      code: 'WAF_FORBIDDEN',
      message: 'Blocked by upstream Web Application Firewall.',
    };
  }

  // 3. Alibaba Baxia CAPTCHA & risk control
  if (
    bodyLower.includes('rgv587') ||
    bodyLower.includes('fail_sys_user_validate') ||
    bodyLower.includes('validate.alicdn.com') ||
    bodyLower.includes('punish')
  ) {
    return {
      kind: 'captcha',
      code: 'FAIL_SYS_USER_VALIDATE',
      message: 'Alibaba risk control / CAPTCHA challenge detected.',
    };
  }

  // 4. Authentication
  if (
    status === 401 ||
    bodyLower.includes('unauthorized') ||
    bodyLower.includes('token_expired') ||
    bodyLower.includes('login_required') ||
    bodyLower.includes('invalid_token')
  ) {
    return {
      kind: 'auth',
      code: 'AUTH_EXPIRED',
      message: 'Account session or token is invalid or expired.',
    };
  }

  // 5. Network / Connectivity
  if (status === 502 || status === 503 || status === 504) {
    return {
      kind: 'network',
      code: `HTTP_${status}`,
      message: `Upstream gateway error ${status}.`,
    };
  }

  // 6. General upstream failure
  return {
    kind: 'upstream',
    code: `HTTP_${status}`,
    message: bodyText
      ? `Upstream error: ${bodyText.slice(0, 200)}`
      : `Upstream returned status ${status}`,
  };
}
