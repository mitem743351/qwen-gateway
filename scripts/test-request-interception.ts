/**
 * scripts/test-request-interception.ts
 *
 * Gate 1 Request Interception Test:
 * 1. Starts a local controlled HTTP server with an HTML page and a JSON API endpoint
 * 2. Launches CloakBrowser and attaches `page.on('request')` and `page.on('response')`
 * 3. Page triggers an outbound fetch with sensitive and non-sensitive headers
 * 4. Interception handler captures URL, method, non-sensitive headers, and response status
 * 5. Verifies sensitive headers (Authorization, Cookie) are redacted
 */

import { createServer, type Server } from 'node:http';
import type { Request, Response } from 'playwright-core';
import { BrowserLauncher } from '../src/browser/launch.js';
import { sanitizeHeaders } from '../src/browser/redaction.js';

interface InterceptedTestServer {
  server: Server;
  url: string;
}

function startInterceptionServer(): Promise<InterceptedTestServer> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const parsedUrl = new URL(req.url || '/', 'http://127.0.0.1');

      if (parsedUrl.pathname === '/api/test-fetch') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', echoed: true }));
        return;
      }

      // Default HTML page triggering an outbound fetch
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head><title>Interception Test</title></head>
          <body>
            <h1>Request Interception Test</h1>
            <script>
              window.triggerFetch = async () => {
                const res = await fetch('/api/test-fetch', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Custom-Client': 'Gate1Verifier',
                    'Authorization': 'Bearer super-secret-key-12345',
                    'Cookie': 'token=jwt-secret-payload; isg=abc'
                  },
                  body: JSON.stringify({ ping: 'pong' })
                });
                return await res.json();
              };
            </script>
          </body>
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

async function runInterceptionTest(): Promise<void> {
  console.log('=== Request Interception Test (Gate 1) ===\n');

  const launcher = BrowserLauncher.getInstance();
  const diag = launcher.getDiagnosticInfo();

  console.log(`Executable Present: ${diag.isExecutablePresent}`);
  if (!diag.isExecutablePresent) {
    console.log('[InterceptionTest] Target Chromium binary is not present on disk.');
  }

  const { server, url } = await startInterceptionServer();

  let interceptedRequest = false;
  let interceptedResponse = false;
  let capturedMethod = '';
  let capturedUrl = '';
  let sanitizedHeaders: Record<string, string> = {};
  let capturedStatus = 0;

  try {
    const browser = await launcher.getBrowser({
      headless: process.env['HEADLESS'] !== 'false',
    });
    const page = await browser.newPage();

    // Attach request listener
    page.on('request', (req: Request) => {
      const reqUrl = req.url();
      if (reqUrl.includes('/api/test-fetch')) {
        interceptedRequest = true;
        capturedMethod = req.method();
        capturedUrl = reqUrl;
        sanitizedHeaders = sanitizeHeaders(req.headers());
      }
    });

    // Attach response listener
    page.on('response', (res: Response) => {
      if (res.url().includes('/api/test-fetch')) {
        interceptedResponse = true;
        capturedStatus = res.status();
      }
    });

    // Navigate to page
    await page.goto(url);

    // Trigger outbound fetch inside browser context
    await page.evaluate(async () => {
      const win = globalThis as unknown as { triggerFetch: () => Promise<unknown> };
      await win.triggerFetch();
    });

    await page.waitForTimeout(500);
    await launcher.close();

    console.log('Interception Results:');
    console.log(`  Intercepted request:  ${interceptedRequest ? 'PASS' : 'FAIL'}`);
    console.log(`  Intercepted response: ${interceptedResponse ? 'PASS' : 'FAIL'}`);
    console.log(`  Captured Method:      ${capturedMethod}`);
    console.log(`  Captured URL:         ${capturedUrl}`);
    console.log(`  Response Status:      ${capturedStatus}`);

    console.log('\nSanitized Headers Captured:');
    for (const [key, val] of Object.entries(sanitizedHeaders)) {
      console.log(`    ${key}: ${val}`);
    }

    // Redaction assertions
    const authRedacted = sanitizedHeaders['authorization'] === '[REDACTED]';
    const cookieRedacted = sanitizedHeaders['cookie'] === '[REDACTED]';
    const customPreserved = sanitizedHeaders['x-custom-client'] === 'Gate1Verifier';

    console.log(`\nRedaction Verification:`);
    console.log(`  Authorization header redacted: ${authRedacted ? 'PASS' : 'FAIL'}`);
    console.log(`  Cookie header redacted:        ${cookieRedacted ? 'PASS' : 'FAIL'}`);
    console.log(`  Non-sensitive header preserved: ${customPreserved ? 'PASS' : 'FAIL'}`);

    if (interceptedRequest && interceptedResponse && authRedacted && cookieRedacted) {
      console.log('\n[InterceptionTest] RESULT: PASS');
    } else {
      console.log('\n[InterceptionTest] RESULT: FAIL');
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('\n[InterceptionTest] RESULT: BLOCKED / FAILED');
    console.error(`Error details: ${msg}`);
  } finally {
    server.close();
  }
}

runInterceptionTest().catch((err) => {
  console.error('[InterceptionTest] Fatal unhandled error:', err);
  process.exit(1);
});
