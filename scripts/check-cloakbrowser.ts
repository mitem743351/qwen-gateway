/**
 * scripts/check-cloakbrowser.ts
 *
 * Diagnostic script to safely inspect and report CloakBrowser package and runtime
 * environment status without attempting authentication or exposing secrets.
 */

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import {
  binaryInfo,
  CHROMIUM_VERSION,
  getDefaultStealthArgs,
  launch,
} from 'cloakbrowser';

interface DiagnosticsReport {
  timestamp: string;
  package: {
    name: string;
    targetChromiumVersion: string;
    defaultStealthArgCount: number;
  };
  binary: {
    version: string;
    platform: string;
    tier: string;
    binaryPath: string;
    installed: boolean;
    cacheDir: string;
    downloadUrl: string;
  };
  system: {
    nodeVersion: string;
    platform: string;
    arch: string;
    hasDisplay: boolean;
    systemChromiumPath: string | null;
  };
  launchViability: {
    viable: boolean;
    reason: string;
    launchAttempted: boolean;
    launchSuccess?: boolean;
    error?: string;
  };
}

function findSystemChromium(): string | null {
  const candidates = [
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ];

  for (const cmd of candidates) {
    try {
      const path = execSync(`which ${cmd} 2>/dev/null`, { encoding: 'utf-8' }).trim();
      if (path && existsSync(path)) {
        return path;
      }
    } catch {
      // Ignore not found
    }
  }
  return null;
}

async function runCheck(): Promise<DiagnosticsReport> {
  const info = binaryInfo();
  const defaultArgs = getDefaultStealthArgs();
  const systemChromium = findSystemChromium();
  const hasDisplay = Boolean(process.env.DISPLAY);

  const report: DiagnosticsReport = {
    timestamp: new Date().toISOString(),
    package: {
      name: 'cloakbrowser',
      targetChromiumVersion: CHROMIUM_VERSION,
      defaultStealthArgCount: defaultArgs.length,
    },
    binary: {
      version: info.version,
      platform: info.platform,
      tier: info.tier,
      binaryPath: info.binaryPath,
      installed: info.installed,
      cacheDir: info.cacheDir,
      downloadUrl: info.downloadUrl,
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      hasDisplay,
      systemChromiumPath: systemChromium,
    },
    launchViability: {
      viable: false,
      reason: '',
      launchAttempted: false,
    },
  };

  const binaryExists = existsSync(info.binaryPath);

  if (!binaryExists && !systemChromium && !process.env.CLOAKBROWSER_BINARY_PATH) {
    report.launchViability.viable = false;
    report.launchViability.reason =
      'CloakBrowser Chromium binary is not installed locally and no system Chromium was found. ' +
      'External download from cloakbrowser.dev is restricted by sandbox egress policy.';
    return report;
  }

  // If binary exists or override is set, attempt a minimal launch
  const launchPath = process.env.CLOAKBROWSER_BINARY_PATH || (binaryExists ? info.binaryPath : systemChromium);

  report.launchViability.viable = true;
  report.launchViability.reason = `Chromium binary available at ${launchPath}`;
  report.launchViability.launchAttempted = true;

  try {
    const launchConfig = launchPath
      ? { headless: true, launchOptions: { executablePath: launchPath } }
      : { headless: true };
    const browser = await launch(launchConfig);
    const page = await browser.newPage();
    const version = browser.version();
    await page.close();
    await browser.close();

    report.launchViability.launchSuccess = true;
    report.launchViability.reason += ` (launched successfully, version: ${version})`;
  } catch (err: unknown) {
    report.launchViability.launchSuccess = false;
    report.launchViability.error = err instanceof Error ? err.message : String(err);
    report.launchViability.reason += ` (launch failed: ${report.launchViability.error})`;
  }

  return report;
}

runCheck()
  .then((report) => {
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error('Diagnostic error:', err);
    process.exit(1);
  });
