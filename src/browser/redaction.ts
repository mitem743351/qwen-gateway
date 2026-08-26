/**
 * src/browser/redaction.ts
 *
 * Sanitization utility redacting sensitive authentication, session,
 * and proxy headers from logs and diagnostics.
 */

export const SENSITIVE_HEADER_NAMES = new Set([
  'cookie',
  'set-cookie',
  'authorization',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
  'bx-ua',
  'bx-umidtoken',
  'bx-v',
]);

/**
 * Redacts values of sensitive headers while preserving the header key
 * and indicating that a value was present.
 */
export function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};

  for (const [key, val] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_HEADER_NAMES.has(lowerKey)) {
      sanitized[key] = '[REDACTED]';
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}
