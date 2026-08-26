/**
 * src/browser/profile.ts
 *
 * Helpers for persistent browser profile directories.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function ensureProfileDir(accountId: string, baseDir?: string): string {
  const root =
    baseDir ??
    process.env['ACCOUNTS_DIR'] ??
    resolve(process.cwd(), 'data/profiles');
  const profilePath = resolve(root, accountId);
  if (!existsSync(profilePath)) {
    mkdirSync(profilePath, { recursive: true });
  }
  return profilePath;
}
