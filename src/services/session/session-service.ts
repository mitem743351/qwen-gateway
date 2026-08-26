/**
 * src/services/session/session-service.ts
 *
 * Manages persistent profile cookies and validates sessions using
 * GET /api/v1/auths/ and POST /api/v2/users/status.
 *
 * Session Architecture Model:
 *   1. Persistent browser profile (data/profiles/<id>/) = authoritative browser/session state.
 *   2. cookies.json in profile dir = cached session/diagnostic metadata.
 *   3. Root cookies.json = explicitly supplied test credential import ONLY, never authoritative.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { COMMON_UPSTREAM_HEADERS, UPSTREAM_ENDPOINTS } from '../upstream-constants.js';

export interface ProfileCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface SessionData {
  accountId: string;
  cookies: Record<string, string>;
  token?: string;
  updatedAt: number;
  status: 'active' | 'needs_login' | 'cooldown';
  cooldownUntil?: number;
}

export class SessionService {
  private readonly accountsDir: string;
  private sessions = new Map<string, SessionData>();

  constructor(accountsDir?: string) {
    this.accountsDir =
      accountsDir ??
      process.env['ACCOUNTS_DIR'] ??
      resolve(process.cwd(), 'data/profiles');
    this.loadAllProfiles();
  }

  /**
   * Loads all saved cookie profiles from the filesystem.
   */
  public loadAllProfiles(): void {
    if (!existsSync(this.accountsDir)) {
      mkdirSync(this.accountsDir, { recursive: true });
      return;
    }
  }

  /**
   * Loads a profile for a specific account ID from disk.
   */
  public getProfile(accountId: string): SessionData | undefined {
    const cached = this.sessions.get(accountId);
    if (cached) return cached;

    const cookiePath = resolve(this.accountsDir, accountId, 'cookies.json');
    if (!existsSync(cookiePath)) {
      return undefined;
    }

    try {
      const data = JSON.parse(readFileSync(cookiePath, 'utf-8'));
      const session: SessionData = {
        accountId,
        cookies: data.cookies || {},
        updatedAt: data.updatedAt || Date.now(),
        status: data.status || 'active',
      };
      if (data.token !== undefined) {
        session.token = data.token;
      }
      if (data.cooldownUntil !== undefined) {
        session.cooldownUntil = data.cooldownUntil;
      }
      this.sessions.set(accountId, session);
      return session;
    } catch {
      return undefined;
    }
  }

  /**
   * Saves or updates a session's cookies and status.
   */
  public saveProfile(session: SessionData): void {
    this.sessions.set(session.accountId, session);
    const cookiePath = resolve(this.accountsDir, session.accountId, 'cookies.json');
    const dir = dirname(cookiePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(cookiePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  /**
   * Generates a Cookie header string from the profile's cookies.
   */
  public getCookieHeader(accountId: string): string {
    const session = this.getProfile(accountId);
    if (!session) return '';

    return Object.entries(session.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Checks session health via GET /api/v1/auths/ [NET]
   */
  public async validateSession(
    accountId: string,
    customFetch?: typeof fetch,
  ): Promise<boolean> {
    const cookieHeader = this.getCookieHeader(accountId);
    if (!cookieHeader) return false;

    const doFetch = customFetch ?? fetch;
    try {
      const res = await doFetch(UPSTREAM_ENDPOINTS.auths, {
        method: 'GET',
        headers: {
          ...COMMON_UPSTREAM_HEADERS,
          Cookie: cookieHeader,
        },
      });

      if (res.status === 200) {
        const json = (await res.json()) as { success?: boolean; data?: unknown };
        if (json.success) {
          const session = this.getProfile(accountId);
          if (session) {
            session.status = 'active';
            this.saveProfile(session);
          }
          return true;
        }
      }
    } catch {
      // Network failure
    }

    const session = this.getProfile(accountId);
    if (session) {
      session.status = 'needs_login';
      this.saveProfile(session);
    }
    return false;
  }
}
