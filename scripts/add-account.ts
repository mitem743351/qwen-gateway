/**
 * scripts/add-account.ts <label>
 *
 * Adds and authenticates a persistent Qwen account profile.
 * Launches CloakBrowser with persistent context, allows the operator to log in,
 * harvests the full cookie jar (token, ssxmod_itna, tfstk, isg, cna),
 * registers the account into AccountPool (SQLite), and validates session health.
 */

import { BrowserLauncher } from '../src/browser/launch.js';
import { ensureProfileDir } from '../src/browser/profile.js';
import { ProfileHarvester } from '../src/browser/harvester.js';
import { SessionService } from '../src/services/session/session-service.js';
import { DefaultAccountPool } from '../src/services/account-pool.js';

async function addAccount(): Promise<void> {
  const label = process.argv[2] || 'account-1';
  const accountId = label.toLowerCase().replace(/[^a-z0-9_-]/g, '_');

  console.log(`[AddAccount] Initializing profile for account: "${label}" (ID: ${accountId})...`);

  const profileDir = ensureProfileDir(accountId);
  const launcher = BrowserLauncher.getInstance();
  const sessionService = new SessionService();
  const pool = new DefaultAccountPool();

  try {
    const context = await launcher.launchPersistent(profileDir, {
      headless: false,
    });

    const page = context.pages()[0] || (await context.newPage());
    console.log('[AddAccount] Navigating to https://chat.qwen.ai for login...');

    await page.goto('https://chat.qwen.ai');

    console.log('[AddAccount] Waiting for user authentication (detecting token cookie)...');

    // Poll for auth token in cookies
    let authenticated = false;
    for (let i = 0; i < 120; i++) {
      const cookies = await context.cookies();
      const hasToken = cookies.some((c) => c.name === 'token' && c.value.length > 20);
      if (hasToken) {
        authenticated = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }

    if (!authenticated) {
      console.warn('[AddAccount] Timed out waiting for login.');
      await context.close();
      return;
    }

    console.log('[AddAccount] Login detected! Harvesting session data...');
    const harvested = await ProfileHarvester.harvestPage(page, context, accountId);
    const sessionData = ProfileHarvester.toSessionData(accountId, harvested);
    sessionService.saveProfile(sessionData);

    pool.addAccount(accountId, label, profileDir);
    console.log(`[AddAccount] Successfully saved account "${label}" to pool and disk.`);

    await context.close();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[AddAccount] Failed to add account: ${msg}`);
  }
}

addAccount().catch(console.error);
