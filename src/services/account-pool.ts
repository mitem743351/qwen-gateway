/**
 * src/services/account-pool.ts
 *
 * Account pool managing multi-account leases, round-robin / least-load rotation,
 * and cooldowns. Implements contracts.ts `AccountPool`.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AccountPool, Lease } from '../types/contracts.js';

export interface AccountRecord {
  id: string;
  label: string;
  profileDir: string;
  status: 'active' | 'cooldown' | 'needs_login';
  cooldownUntil: number;
  inflight: number;
}

export class DefaultAccountPool implements AccountPool {
  private db: Database.Database;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath =
      dbPath ?? process.env['DB_PATH'] ?? resolve(process.cwd(), 'data/gateway.sqlite');

    const dir = dirname(this.dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.initDb();
  }

  private initDb(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        profile_dir TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active',
        cooldown_until INTEGER NOT NULL DEFAULT 0,
        inflight INTEGER NOT NULL DEFAULT 0
      );
    `);
  }

  /**
   * Adds or registers an account in the pool.
   */
  public addAccount(id: string, label: string, profileDir: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO accounts (id, label, profile_dir, status, cooldown_until, inflight)
      VALUES (?, ?, ?, 'active', 0, 0)
      ON CONFLICT(id) DO UPDATE SET
        label=excluded.label,
        profile_dir=excluded.profile_dir;
    `);
    stmt.run(id, label, profileDir);
  }

  /**
   * Acquires a lease on the best available account (least inflight, not in cooldown).
   */
  public async acquire(): Promise<Lease & { accountId: string }> {
    const now = Date.now();

    // Select active account with least inflight
    const stmt = this.db.prepare(`
      SELECT id, label, profile_dir, status, cooldown_until as cooldownUntil, inflight
      FROM accounts
      WHERE status = 'active' AND cooldown_until <= ?
      ORDER BY inflight ASC
      LIMIT 1
    `);

    const row = stmt.get(now) as AccountRecord | undefined;
    const accountId = row ? row.id : 'default_account';

    if (row) {
      this.db.prepare('UPDATE accounts SET inflight = inflight + 1 WHERE id = ?').run(row.id);
    }

    let released = false;
    const lease: Lease & { accountId: string } = {
      accountId,
      release: () => {
        if (!released) {
          released = true;
          if (row) {
            this.db.prepare('UPDATE accounts SET inflight = MAX(0, inflight - 1) WHERE id = ?').run(row.id);
          }
        }
      },
    };

    return lease;
  }

  /**
   * Applies cooldown to an account after rate-limit or risk trigger.
   */
  public setCooldown(accountId: string, durationMs: number): void {
    const until = Date.now() + durationMs;
    this.db.prepare(`
      UPDATE accounts SET status = 'cooldown', cooldown_until = ? WHERE id = ?
    `).run(until, accountId);
  }

  /**
   * Returns snapshot status for all accounts in the pool.
   */
  public status(): Array<{
    label: string;
    status: string;
    cooldownUntil?: number;
    inflight: number;
  }> {
    const stmt = this.db.prepare(`
      SELECT label, status, cooldown_until as cooldownUntil, inflight FROM accounts
    `);
    const rows = stmt.all() as Array<{
      label: string;
      status: string;
      cooldownUntil: number;
      inflight: number;
    }>;

    return rows.map((r) => {
      const entry: {
        label: string;
        status: string;
        cooldownUntil?: number;
        inflight: number;
      } = {
        label: r.label,
        status: r.status,
        inflight: r.inflight,
      };
      if (r.cooldownUntil > 0) {
        entry.cooldownUntil = r.cooldownUntil;
      }
      return entry;
    });
  }

  public close(): void {
    this.db.close();
  }
}
