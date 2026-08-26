/**
 * src/browser/profile.ts
 *
 * Helpers for persistent browser profiles:
 * - deterministic path resolution
 * - path normalization and traversal prevention
 * - profile ID validation
 * - in-process profile locking to prevent concurrent operations
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, normalize } from 'node:path';

const VALID_PROFILE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const activeProfileLocks = new Set<string>();

export interface ProfileResolution {
  profileId: string;
  profileDir: string;
  isNew: boolean;
}

/**
 * Validates a profile ID to ensure it is safe and does not contain
 * directory traversal attempts, whitespace, or invalid characters.
 */
export function validateProfileId(profileId: string): string {
  const trimmed = profileId.trim();
  if (!trimmed) {
    throw new Error('Profile ID cannot be empty.');
  }
  if (trimmed.includes('..') || trimmed.includes('/') || trimmed.includes('\\')) {
    throw new Error(`Invalid profile ID '${profileId}': path traversal characters are forbidden.`);
  }
  if (!VALID_PROFILE_ID_REGEX.test(trimmed)) {
    throw new Error(
      `Invalid profile ID '${profileId}': only alphanumeric characters, dashes, and underscores are permitted.`,
    );
  }
  return trimmed;
}

/**
 * Resolves a deterministic, normalized directory path for a given profile ID.
 */
export function resolveProfileDir(profileId: string, baseDir?: string): string {
  const safeId = validateProfileId(profileId);
  const root =
    baseDir ??
    process.env['ACCOUNTS_DIR'] ??
    resolve(process.cwd(), 'data/profiles');

  const resolvedRoot = resolve(normalize(root));
  const fullPath = resolve(resolvedRoot, safeId);

  // Safety assertion against directory traversal escapes
  if (!fullPath.startsWith(resolvedRoot)) {
    throw new Error(`Profile path '${fullPath}' escapes base directory '${resolvedRoot}'.`);
  }

  return fullPath;
}

/**
 * Ensures that the profile directory exists and returns resolution info.
 */
export function ensureProfileDir(profileId: string, baseDir?: string): ProfileResolution {
  const dirPath = resolveProfileDir(profileId, baseDir);
  const isNew = !existsSync(dirPath);

  if (isNew) {
    mkdirSync(dirPath, { recursive: true });
  }

  return {
    profileId,
    profileDir: dirPath,
    isNew,
  };
}

/**
 * Acquires an in-process lock for a profile directory to prevent concurrent mutations.
 */
export function acquireProfileLock(profileId: string): () => void {
  const safeId = validateProfileId(profileId);
  if (activeProfileLocks.has(safeId)) {
    throw new Error(`Profile '${safeId}' is already in use by another operation.`);
  }
  activeProfileLocks.add(safeId);

  return () => {
    activeProfileLocks.delete(safeId);
  };
}

/**
 * Safely removes a profile directory (used for temporary test profiles like _gate1).
 */
export function cleanupProfileDir(profileId: string, baseDir?: string): void {
  const dirPath = resolveProfileDir(profileId, baseDir);
  if (existsSync(dirPath)) {
    rmSync(dirPath, { recursive: true, force: true });
  }
}
