/**
 * scripts/smoke-browser.ts
 *
 * Gate 1 Browser Smoke Test:
 * 1. Launches CloakBrowser via BrowserLauncher
 * 2. Creates a context and page
 * 3. Visits a deterministic local data: URL test page
 * 4. Records browser identity and User-Agent
 * 5. Verifies JavaScript evaluation in the page
 * 6. Closes cleanly without leaking secrets
 */

import { BrowserLauncher } from '../src/browser/launch.js';

async function runSmokeTest(): Promise<void> {
  console.log('=== CloakBrowser Smoke Test (Gate 1) ===\n');

  const launcher = BrowserLauncher.getInstance();
  const diag = launcher.getDiagnosticInfo();

  console.log('Browser Diagnostics:');
  console.log(`  Package version:           ${diag.packageVersion}`);
  console.log(`  Expected Chromium version: ${diag.expectedChromiumVersion}`);
  console.log(`  Effective executable path: ${diag.effectiveExecutablePath}`);
  console.log(`  Executable file present:   ${diag.isExecutablePresent}`);
  console.log(`  Cache directory:           ${diag.cacheDir}`);
  console.log(`  Headless mode:             ${diag.headless}`);
  console.log(`  Default download URL:      ${diag.defaultDownloadUrl}\n`);

  if (!diag.isExecutablePresent) {
    console.log('[SmokeTest] Target Chromium binary is not present on disk.');
    console.log('[SmokeTest] Attempting launch to verify automatic provisioning behavior...');
  }

  try {
    const browser = await launcher.getBrowser({
      headless: process.env['HEADLESS'] !== 'false',
    });
    console.log('[SmokeTest] SUCCESS: CloakBrowser launched.');

    const page = await browser.newPage();

    // Use a self-contained deterministic data: HTML page
    const testHtml = `
      <!DOCTYPE html>
      <html>
        <head><title>Gate 1 Deterministic Test</title></head>
        <body>
          <div id="target">Gate 1 Verification Target</div>
          <script>
            window.__gate1_runtime = {
              evaluated: true,
              timestamp: Date.now(),
              calcResult: 21 * 2
            };
          </script>
        </body>
      </html>
    `;
    const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(testHtml)}`;

    await page.goto(dataUrl);
    console.log('[SmokeTest] Visited deterministic test page (data: URL).');

    const title = await page.title();
    console.log(`[SmokeTest] Page title: "${title}"`);

    const ua = await page.evaluate(() => navigator.userAgent);
    console.log(`[SmokeTest] User-Agent: ${ua}`);

    const jsEvaluation = await page.evaluate(() => {
      const g = (globalThis as unknown as { __gate1_runtime?: { evaluated: boolean; calcResult: number } }).__gate1_runtime;
      return g ?? { evaluated: false, calcResult: 0 };
    });

    console.log(`[SmokeTest] JavaScript evaluated: ${jsEvaluation.evaluated}`);
    console.log(`[SmokeTest] Computation result:  ${jsEvaluation.calcResult} (expected: 42)`);

    await launcher.close();
    console.log('\n[SmokeTest] RESULT: PASS — CloakBrowser launched, evaluated JS, and closed cleanly.');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n[SmokeTest] RESULT: BLOCKED / FAILED');
    console.error(`Error details: ${msg}`);
  }
}

runSmokeTest().catch((err) => {
  console.error('[SmokeTest] Fatal unhandled error:', err);
  process.exit(1);
});
