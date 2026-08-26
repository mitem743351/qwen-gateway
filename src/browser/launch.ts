/**
 * src/browser/launch.ts
 *
 * CloakBrowser launcher wrapper supporting singleton management,
 * custom binary path overrides, headless toggles, persistent context launching,
 * and safe diagnostic inspection without leaking sensitive values.
 */

import {
  launch,
  launchPersistentContext,
  binaryInfo,
  CHROMIUM_VERSION,
  type LaunchOptions as CloakLaunchOptions,
  type LaunchPersistentContextOptions,
} from 'cloakbrowser';
import type { Browser, BrowserContext } from 'playwright-core';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

export interface BrowserConfig {
  headless?: boolean;
  proxy?: string;
  binaryPath?: string;
  licenseKey?: string;
  userDataDir?: string;
}

export interface BrowserDiagnosticInfo {
  packageVersion: string;
  expectedChromiumVersion: string;
  effectiveExecutablePath: string;
  isExecutablePresent: boolean;
  cacheDir: string;
  defaultDownloadUrl: string;
  headless: boolean;
  userDataDir?: string;
}

export class BrowserLauncher {
  private static instance: BrowserLauncher | null = null;
  private browser: Browser | null = null;
  private activeContexts = new Set<BrowserContext>();

  public static getInstance(): BrowserLauncher {
    if (!BrowserLauncher.instance) {
      BrowserLauncher.instance = new BrowserLauncher();
    }
    return BrowserLauncher.instance;
  }

  /**
   * Resolves the effective executable path to use.
   * Priority: explicit config > CLOAKBROWSER_BINARY_PATH env > cloakbrowser binaryInfo path.
   */
  public resolveExecutablePath(configPath?: string): string {
    if (configPath && configPath.trim().length > 0) {
      return resolve(configPath.trim());
    }
    const envPath = process.env['CLOAKBROWSER_BINARY_PATH'];
    if (envPath && envPath.trim().length > 0) {
      return resolve(envPath.trim());
    }
    const info = binaryInfo();
    return info.binaryPath;
  }

  /**
   * Returns diagnostic information about the browser runtime environment.
   */
  public getDiagnosticInfo(config: BrowserConfig = {}): BrowserDiagnosticInfo {
    const info = binaryInfo();
    const effectiveExecutable = this.resolveExecutablePath(config.binaryPath);
    const headless = config.headless ?? (process.env['HEADLESS'] !== 'false');

    const result: BrowserDiagnosticInfo = {
      packageVersion: '0.5.9',
      expectedChromiumVersion: CHROMIUM_VERSION,
      effectiveExecutablePath: effectiveExecutable,
      isExecutablePresent: existsSync(effectiveExecutable),
      cacheDir: info.cacheDir,
      defaultDownloadUrl: info.downloadUrl,
      headless,
    };
    if (config.userDataDir) {
      result.userDataDir = resolve(config.userDataDir);
    }
    return result;
  }

  /**
   * Launches or returns a singleton CloakBrowser instance.
   */
  public async getBrowser(config: BrowserConfig = {}): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    const headless = config.headless ?? (process.env['HEADLESS'] !== 'false');
    const effectiveExecutable = this.resolveExecutablePath(config.binaryPath);
    const proxy = config.proxy ?? process.env['PROXY'];

    const launchOpts: Record<string, unknown> = {};
    if (effectiveExecutable && existsSync(effectiveExecutable)) {
      launchOpts['executablePath'] = effectiveExecutable;
    }

    const options: CloakLaunchOptions = {
      headless,
    };
    if (proxy) {
      options.proxy = proxy;
    }
    if (Object.keys(launchOpts).length > 0) {
      options.launchOptions = launchOpts;
    }

    try {
      this.browser = await launch(options);
      return this.browser;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[BrowserLauncher] Failed to launch CloakBrowser (executable: ${effectiveExecutable}): ${msg}`,
      );
    }
  }

  /**
   * Launches a persistent browser context for a specific profile directory.
   */
  public async launchPersistent(
    profileDir: string,
    config: BrowserConfig = {},
  ): Promise<BrowserContext> {
    const resolvedDir = resolve(profileDir);
    const headless = config.headless ?? (process.env['HEADLESS'] !== 'false');
    const effectiveExecutable = this.resolveExecutablePath(config.binaryPath);
    const proxy = config.proxy ?? process.env['PROXY'];

    const launchOpts: Record<string, unknown> = {};
    if (effectiveExecutable && existsSync(effectiveExecutable)) {
      launchOpts['executablePath'] = effectiveExecutable;
    }

    const options: LaunchPersistentContextOptions = {
      userDataDir: resolvedDir,
      headless,
    };
    if (proxy) {
      options.proxy = proxy;
    }
    if (Object.keys(launchOpts).length > 0) {
      options.launchOptions = launchOpts;
    }

    try {
      const context = await launchPersistentContext(options);
      this.activeContexts.add(context);
      return context;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `[BrowserLauncher] Failed to launch persistent context in ${resolvedDir}: ${msg}`,
      );
    }
  }

  /**
   * Closes all active contexts and the singleton browser.
   */
  public async close(): Promise<void> {
    for (const ctx of this.activeContexts) {
      try {
        await ctx.close();
      } catch {
        // Ignore closing errors
      }
    }
    this.activeContexts.clear();

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {
        // Ignore closing errors
      }
      this.browser = null;
    }
  }
}
