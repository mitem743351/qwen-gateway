/**
 * scripts/import-test-cookies.ts
 *
 * Imports and validates supplied cookies.json for testing.
 * - Reads supplied cookies.json
 * - Validates schema and fields
 * - Redacts all sensitive cookie values from output
 * - Converts to Playwright-compatible cookie format
 * - Injects into persistent browser context if CloakBrowser runtime is available
 * - Reports safe metadata (names, domains, paths, secure/httpOnly flags, expiry)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BrowserLauncher } from '../src/browser/launch.js';
import { resolveProfileDir, cleanupProfileDir } from '../src/browser/profile.js';

export interface RawExportCookie {
  name: string;
  value?: string;
  domain?: string;
  path?: string;
  expires?: number;
  expirationDate?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: string | null;
}

export interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
}

export interface CookieMetadata {
  name: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  expires: number | string;
  hasValue: boolean;
}

export function parseAndValidateCookies(filePath: string): {
  playwrightCookies: PlaywrightCookie[];
  metadata: CookieMetadata[];
  domains: string[];
} {
  if (!existsSync(filePath)) {
    throw new Error(`Cookie file not found at ${filePath}`);
  }

  const content = readFileSync(filePath, 'utf-8');
  let rawList: unknown;
  try {
    rawList = JSON.parse(content);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid JSON in cookie file: ${msg}`);
  }

  if (!Array.isArray(rawList)) {
    throw new Error('Cookie file must be an array of cookie objects.');
  }

  const playwrightCookies: PlaywrightCookie[] = [];
  const metadata: CookieMetadata[] = [];
  const domainSet = new Set<string>();

  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const c = item as RawExportCookie;

    if (!c.name || typeof c.name !== 'string') continue;

    const domain = c.domain ?? '.qwen.ai';
    const path = c.path ?? '/';
    const secure = Boolean(c.secure);
    const httpOnly = Boolean(c.httpOnly);
    domainSet.add(domain);

    // Normalize sameSite for Playwright
    let sameSite: 'Strict' | 'Lax' | 'None' | undefined;
    const rawSameSite = (c.sameSite ?? '').toLowerCase();
    if (rawSameSite === 'strict') sameSite = 'Strict';
    else if (rawSameSite === 'lax') sameSite = 'Lax';
    else if (rawSameSite === 'none' || rawSameSite === 'no_restriction') sameSite = 'None';

    const rawExpiry = c.expires ?? c.expirationDate;
    const expires = typeof rawExpiry === 'number' ? Math.floor(rawExpiry) : undefined;

    const cookieObj: PlaywrightCookie = {
      name: c.name,
      value: c.value ?? '',
      domain,
      path,
      secure,
      httpOnly,
    };
    if (sameSite !== undefined) {
      cookieObj.sameSite = sameSite;
    }
    if (expires !== undefined && expires > 0) {
      cookieObj.expires = expires;
    }

    playwrightCookies.push(cookieObj);

    metadata.push({
      name: c.name,
      domain,
      path,
      secure,
      httpOnly,
      sameSite: sameSite ?? 'unspecified',
      expires: expires ? new Date(expires * 1000).toISOString() : 'session',
      hasValue: typeof c.value === 'string' && c.value.length > 0,
    });
  }

  return {
    playwrightCookies,
    metadata,
    domains: Array.from(domainSet),
  };
}

async function runImport(): Promise<void> {
  console.log('=== Test Cookies Import & Validation (Step 8) ===\n');

  const cookiePath = resolve(process.cwd(), 'cookies.json');
  console.log(`Cookie file path: ${cookiePath}`);

  let parsedData: ReturnType<typeof parseAndValidateCookies>;
  try {
    parsedData = parseAndValidateCookies(cookiePath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`Failed to parse cookies.json: ${msg}`);
    return;
  }

  console.log(`Format:            Chrome/Extension export array`);
  console.log(`Total cookies:     ${parsedData.playwrightCookies.length}`);
  console.log(`Target domains:    ${parsedData.domains.join(', ')}`);
  console.log(`Targeting Qwen:    ${parsedData.domains.some((d) => d.includes('qwen.ai'))}`);

  console.log('\nParsed Cookie Inventory (Values REDACTED):');
  for (const m of parsedData.metadata) {
    console.log(
      `  - ${m.name.padEnd(16)} | domain: ${m.domain.padEnd(14)} | path: ${m.path} | httpOnly: ${String(m.httpOnly).padEnd(5)} | secure: ${String(m.secure).padEnd(5)} | expires: ${m.expires} | hasValue: ${m.hasValue}`,
    );
  }

  // Check key auth / session tokens
  const hasToken = parsedData.metadata.some((m) => m.name === 'token' && m.hasValue);
  const hasCna = parsedData.metadata.some((m) => m.name === 'cna' && m.hasValue);
  const hasIsg = parsedData.metadata.some((m) => m.name === 'isg' && m.hasValue);
  const hasTfstk = parsedData.metadata.some((m) => m.name === 'tfstk' && m.hasValue);
  const hasSsxmod = parsedData.metadata.some((m) => m.name.startsWith('ssxmod_') && m.hasValue);

  console.log('\nKey Session Token Inventory:');
  console.log(`  token (auth JWT):    ${hasToken ? 'PRESENT' : 'MISSING'}`);
  console.log(`  cna (device token):  ${hasCna ? 'PRESENT' : 'MISSING'}`);
  console.log(`  isg (baxia seed):    ${hasIsg ? 'PRESENT' : 'MISSING'}`);
  console.log(`  tfstk (baxia risk):  ${hasTfstk ? 'PRESENT' : 'MISSING'}`);
  console.log(`  ssxmod (WAF cookie): ${hasSsxmod ? 'PRESENT' : 'MISSING'}`);

  // Test injection into CloakBrowser persistent profile if runtime exists
  const launcher = BrowserLauncher.getInstance();
  const diag = launcher.getDiagnosticInfo();

  if (!diag.isExecutablePresent) {
    console.log(
      '\n[Browser Injection] SKIPPED: Chromium executable is not present on disk.',
    );
    console.log(
      '[Browser Injection] Cookies are parsed and ready for Playwright context.addCookies() once executable is provisioned.',
    );
    return;
  }

  const testProfileId = '_cookie_test';
  const profileDir = resolveProfileDir(testProfileId);

  try {
    console.log(`\n[Browser Injection] Launching test persistent context at ${profileDir}...`);
    const context = await launcher.launchPersistent(profileDir, {
      headless: process.env['HEADLESS'] !== 'false',
    });

    console.log(`[Browser Injection] Adding ${parsedData.playwrightCookies.length} cookies to context...`);
    await context.addCookies(parsedData.playwrightCookies);
    console.log('[Browser Injection] SUCCESS: Cookies injected into browser context.');

    await context.close();
    cleanupProfileDir(testProfileId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Browser Injection] Failed to inject cookies: ${msg}`);
  }
}

runImport().catch(console.error);
