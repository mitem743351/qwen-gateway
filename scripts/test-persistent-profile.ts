/**
 * scripts/test-persistent-profile.ts
 *
 * Gate 1 Persistent Profile Lifecycle Test:
 * Run 1:
 *   - Launch persistent context at data/profiles/_gate1/
 *   - Navigate to local test server
 *   - Set harmless browser state in localStorage
 *   - Close context
 *
 * Run 2:
 *   - Reopen same persistent context at data/profiles/_gate1/
 *   - Navigate to local test server
 *   - Read and verify localStorage state survived restart
 *   - Close context
 *   - Clean up profile directory
 */

import { createServer, type Server } from 'node:http';
import { BrowserLauncher } from '../src/browser/launch.js';
import { resolveProfileDir, cleanupProfileDir } from '../src/browser/profile.js';

interface TestServerInfo {
  server: Server;
  url: string;
}

function startLocalTestServer(): Promise<TestServerInfo> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Persistent Profile Test Page</title></head>
          <body><h1>Gate 1 Persistence Test</h1></body>
        </html>
      `);
    });

    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
      });
    });
  });
}

async function runPersistenceTest(): Promise<void> {
  console.log('=== Persistent Profile Lifecycle Test (Gate 1) ===\n');

  const profileId = '_gate1';
  const profileDir = resolveProfileDir(profileId);
  const launcher = BrowserLauncher.getInstance();
  const diag = launcher.getDiagnosticInfo({ userDataDir: profileDir });

  console.log(`Profile Path: ${profileDir}`);
  console.log(`Executable Present: ${diag.isExecutablePresent}`);

  if (!diag.isExecutablePresent) {
    console.log('[PersistenceTest] Executable is not present on disk.');
  }

  const { server, url } = await startLocalTestServer();
  const testKey = 'gate1_persistence_token';
  const testVal = `persisted_at_${Date.now()}`;

  let run1Success = false;
  let run2Success = false;
  let stateMatches = false;

  try {
    // ── Run 1: Create persistent context & set state ──
    console.log('\n[Run 1] Creating persistent context and writing state...');
    const context1 = await launcher.launchPersistent(profileDir, {
      headless: process.env['HEADLESS'] !== 'false',
    });
    const page1 = context1.pages()[0] || (await context1.newPage());
    await page1.goto(url);

    await page1.evaluate(
      ({ key, val }) => {
        localStorage.setItem(key, val);
      },
      { key: testKey, val: testVal },
    );

    const writtenVal = await page1.evaluate(
      (key) => localStorage.getItem(key),
      testKey,
    );
    console.log(`[Run 1] State written to localStorage: "${writtenVal}"`);
    run1Success = writtenVal === testVal;

    await context1.close();
    console.log('[Run 1] Context closed cleanly.');

    // ── Run 2: Reopen same persistent context & verify state ──
    console.log('\n[Run 2] Reopening persistent context and verifying state...');
    const context2 = await launcher.launchPersistent(profileDir, {
      headless: process.env['HEADLESS'] !== 'false',
    });
    const page2 = context2.pages()[0] || (await context2.newPage());
    await page2.goto(url);

    const readVal = await page2.evaluate(
      (key) => localStorage.getItem(key),
      testKey,
    );
    console.log(`[Run 2] State retrieved from localStorage: "${readVal}"`);
    run2Success = true;
    stateMatches = readVal === testVal;

    await context2.close();
    console.log('[Run 2] Context closed cleanly.');

    // ── Persistence Evaluation ──
    console.log('\nResults:');
    console.log(`  profile path:        ${profileDir}`);
    console.log(`  first-run result:    ${run1Success ? 'PASS' : 'FAIL'}`);
    console.log(`  second-run result:   ${run2Success ? 'PASS' : 'FAIL'}`);
    console.log(`  persistence result:  ${stateMatches ? 'PASS' : 'FAIL'}`);

    // Cleanup smoke profile
    cleanupProfileDir(profileId);
    console.log('[Cleanup] Cleaned up temporary profile data/profiles/_gate1/');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n[PersistenceTest] RESULT: BLOCKED / FAILED');
    console.error(`Error details: ${msg}`);
    console.log(`  profile path:        ${profileDir}`);
    console.log(`  first-run result:    BLOCKED`);
    console.log(`  second-run result:   NOT_RUN`);
    console.log(`  persistence result:  BLOCKED`);
  } finally {
    server.close();
  }
}

runPersistenceTest().catch((err) => {
  console.error('[PersistenceTest] Fatal unhandled error:', err);
  process.exit(1);
});
