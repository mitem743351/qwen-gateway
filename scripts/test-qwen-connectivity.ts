/**
 * scripts/test-qwen-connectivity.ts
 *
 * Diagnostic script characterizing network reachability to https://chat.qwen.ai
 * across discrete OSI / protocol layers:
 * 1. DNS resolution
 * 2. TCP connection
 * 3. TLS handshake
 * 4. HTTP response
 * 5. Browser navigation (when browser executable is available)
 *
 * Grounded in Gate 1 Step 9 instructions: connectivity characterization only,
 * no logins, no completions, no WAF bypass attempts.
 */

import { lookup } from 'node:dns/promises';
import { Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';
import { BrowserLauncher } from '../src/browser/launch.js';

interface LayerDiagnostic {
  layer: string;
  status: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  details: string;
}

async function checkDns(hostname: string): Promise<LayerDiagnostic> {
  try {
    const res = await lookup(hostname);
    return {
      layer: 'DNS Resolution',
      status: 'SUCCESS',
      details: `Resolved ${hostname} -> IP: ${res.address} (family: IPv${res.family})`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      layer: 'DNS Resolution',
      status: 'FAILED',
      details: `DNS lookup failed: ${msg}`,
    };
  }
}

async function checkTcp(ip: string, port: number): Promise<LayerDiagnostic> {
  return new Promise((resolve) => {
    const socket = new Socket();
    socket.setTimeout(5000);

    socket.on('connect', () => {
      socket.destroy();
      resolve({
        layer: 'TCP Connection',
        status: 'SUCCESS',
        details: `Established TCP connection to ${ip}:${port}`,
      });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        layer: 'TCP Connection',
        status: 'FAILED',
        details: `Connection to ${ip}:${port} timed out after 5000ms`,
      });
    });

    socket.on('error', (err) => {
      resolve({
        layer: 'TCP Connection',
        status: 'FAILED',
        details: `TCP error: ${err.message}`,
      });
    });

    socket.connect(port, ip);
  });
}

async function checkTls(hostname: string, port: number): Promise<LayerDiagnostic> {
  return new Promise((resolve) => {
    const socket = tlsConnect(
      {
        host: hostname,
        port,
        servername: hostname,
        timeout: 5000,
      },
      () => {
        const cipher = socket.getCipher();
        const proto = socket.getProtocol();
        socket.end();
        resolve({
          layer: 'TLS Handshake',
          status: 'SUCCESS',
          details: `Negotiated ${proto} with cipher ${cipher.name}`,
        });
      },
    );

    socket.on('timeout', () => {
      socket.destroy();
      resolve({
        layer: 'TLS Handshake',
        status: 'FAILED',
        details: `TLS handshake timed out after 5000ms`,
      });
    });

    socket.on('error', (err) => {
      resolve({
        layer: 'TLS Handshake',
        status: 'FAILED',
        details: `TLS handshake error: ${err.message}`,
      });
    });
  });
}

async function checkHttp(url: string): Promise<LayerDiagnostic> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    return {
      layer: 'HTTP Request',
      status: 'SUCCESS',
      details: `HTTP ${res.status} ${res.statusText}`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      layer: 'HTTP Request',
      status: 'FAILED',
      details: `HTTP request failed: ${msg}`,
    };
  }
}

async function checkBrowserNavigation(url: string): Promise<LayerDiagnostic> {
  const launcher = BrowserLauncher.getInstance();
  const diag = launcher.getDiagnosticInfo();

  if (!diag.isExecutablePresent) {
    return {
      layer: 'Browser Navigation',
      status: 'SKIPPED',
      details: 'Browser executable is not present on disk; cannot attempt browser navigation.',
    };
  }

  try {
    const browser = await launcher.getBrowser({
      headless: process.env['HEADLESS'] !== 'false',
    });
    const page = await browser.newPage();
    await page.goto(url, { timeout: 10000 });
    const title = await page.title();
    await launcher.close();

    return {
      layer: 'Browser Navigation',
      status: 'SUCCESS',
      details: `Navigated to ${url}. Page title: "${title}"`,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      layer: 'Browser Navigation',
      status: 'FAILED',
      details: `Browser navigation error: ${msg}`,
    };
  }
}

async function runConnectivityAudit(): Promise<void> {
  console.log('=== External Connectivity Audit: https://chat.qwen.ai ===\n');

  const hostname = 'chat.qwen.ai';
  const targetUrl = `https://${hostname}`;
  const diagnostics: LayerDiagnostic[] = [];

  // 1. DNS Resolution
  const dnsRes = await checkDns(hostname);
  diagnostics.push(dnsRes);

  let ip = '';
  if (dnsRes.status === 'SUCCESS') {
    const match = dnsRes.details.match(/IP: ([0-9a-f.:]+)/);
    ip = match && match[1] ? match[1] : '';
  }

  // 2. TCP Connection
  if (ip) {
    const tcpRes = await checkTcp(ip, 443);
    diagnostics.push(tcpRes);
  } else {
    diagnostics.push({
      layer: 'TCP Connection',
      status: 'SKIPPED',
      details: 'Skipped due to DNS resolution failure.',
    });
  }

  // 3. TLS Handshake
  const tlsRes = await checkTls(hostname, 443);
  diagnostics.push(tlsRes);

  // 4. HTTP Response
  const httpRes = await checkHttp(targetUrl);
  diagnostics.push(httpRes);

  // 5. Browser Navigation
  const browserRes = await checkBrowserNavigation(targetUrl);
  diagnostics.push(browserRes);

  // Output table
  console.table(diagnostics);

  console.log('\nAudit Summary:');
  for (const d of diagnostics) {
    console.log(`[${d.layer}] ${d.status}: ${d.details}`);
  }
}

runConnectivityAudit().catch(console.error);
