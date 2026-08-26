/**
 * src/server/auth-middleware.ts
 *
 * Middleware validating Bearer API keys against the `API_KEYS` environment variable.
 */

import type { Context, Next } from 'hono';

export async function authMiddleware(c: Context, next: Next): Promise<Response | void> {
  const configuredKeys = (process.env['API_KEYS'] || '')
    .split(',')
    .map((k) => k.trim())
    .filter(Boolean);

  // If no API keys configured, allow open local access
  if (configuredKeys.length === 0) {
    return await next();
  }

  // Exempt /healthz from auth
  if (c.req.path === '/healthz') {
    return await next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          message: 'Missing or invalid Authorization header. Expected Bearer token.',
          type: 'invalid_request_error',
          code: 'unauthorized',
        },
      },
      401,
    );
  }

  const token = authHeader.slice(7).trim();
  if (!configuredKeys.includes(token)) {
    return c.json(
      {
        error: {
          message: 'Incorrect API key provided.',
          type: 'invalid_request_error',
          code: 'invalid_api_key',
        },
      },
      401,
    );
  }

  return await next();
}
