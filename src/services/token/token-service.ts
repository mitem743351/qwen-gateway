/**
 * src/services/token/token-service.ts
 *
 * Manages Alibaba Baxia token trio:
 *   - bx-ua
 *   - bx-umidtoken
 *   - bx-v
 * Caches tokens per account with proactive TTL refresh.
 */

export interface BaxiaTrio {
  bxUa: string;
  bxUmidtoken: string;
  bxV: string;
  expiresAt: number;
}

export class TokenService {
  private cache = new Map<string, BaxiaTrio>();
  private readonly defaultTtlMs = 20 * 60 * 1000; // 20 minutes

  /**
   * Sets or updates the harvested Baxia trio for an account.
   */
  public setTokens(
    accountId: string,
    trio: { bxUa: string; bxUmidtoken: string; bxV: string; ttlMs?: number },
  ): void {
    const expiresAt = Date.now() + (trio.ttlMs ?? this.defaultTtlMs);
    this.cache.set(accountId, {
      bxUa: trio.bxUa,
      bxUmidtoken: trio.bxUmidtoken,
      bxV: trio.bxV,
      expiresAt,
    });
  }

  /**
   * Gets active Baxia tokens for an account.
   */
  public getTokens(accountId: string): BaxiaTrio | undefined {
    const entry = this.cache.get(accountId);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(accountId);
      return undefined;
    }
    return entry;
  }

  /**
   * Returns request headers for Baxia if tokens are present.
   */
  public getHeaders(accountId: string): Record<string, string> {
    const trio = this.getTokens(accountId);
    if (!trio) {
      return {};
    }
    return {
      'bx-ua': trio.bxUa,
      'bx-umidtoken': trio.bxUmidtoken,
      'bx-v': trio.bxV,
    };
  }

  /**
   * Generates synthetic fallback tokens when harvesting is unavailable.
   */
  public getSyntheticTokens(accountId: string): Record<string, string> {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 10);
    return {
      'bx-ua': `2.0.0-${rand}-${ts}`,
      'bx-umidtoken': `c-${rand}-${ts}`,
      'bx-v': '2.5.0',
    };
  }
}
