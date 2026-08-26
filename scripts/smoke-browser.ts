/**
 * scripts/smoke-browser.ts
 *
 * Phase 1 smoke test: launches CloakBrowser, navigates to chat.qwen.ai,
 * dumps safe diagnostic cookie counts and User-Agent, and shuts down.
 */

import { BrowserLauncher } from '../src/browser/launch.js';

async function smokeBrowser(): Promise<void> {
  console.log('[SmokeBrowser] Starting CloakBrowser smoke test...');
  const launcher = BrowserLauncher.getInstance();

  try {
    const browser = await launcher.getBrowser({
      headless: process.env['HEADLESS'] !== 'false',
    });
    console.log('[SmokeBrowser] Browser launched successfully.');

    const page = await browser.newPage();
    const ua = await page.evaluate(() => navigator.userAgent);
    console.log(`[SmokeBrowser] User-Agent: ${ua}`);

    console.log('[SmokeBrowser] Navigating to https://chat.qwen.ai...');
    try {
      await page.goto('https://chat.qwen.ai', { timeout: 15000 });
      const title = await page.title();
      console.log(`[SmokeBrowser] Page title: ${title}`);
    } catch (navErr: unknown) {
      const msg = navErr instanceof Error ? navErr.message : String(navErr);
      console.warn(`[SmokeBrowser] Navigation blocked or timed out: ${msg}`);
    }

    const context = page.context();
    const cookies = await context.cookies();
    console.log(`[SmokeBrowser] Cookies harvested: ${cookies.length}`);
    for (const c of cookies) {
      console.log(`  - ${c.name} (${c.domain})`);
    }

    await browser.close();
    console.log('[SmokeBrowser] Smoke test completed cleanly.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[SmokeBrowser] Launch failed: ${msg}`);
  }
}

smokeBrowser().catch(console.error);
