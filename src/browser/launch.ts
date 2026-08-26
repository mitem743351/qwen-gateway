/**
 * src/browser/launch.ts
 *
 * CloakBrowser launcher wrapper supporting singleton management,
 * custom binary path overrides, headless toggles, and proxy configuration.
 */

import { launch, launchPersistentContext } from 'cloakbrowser';
import type { LaunchPersistentContextOptions } from 'cloakbrowser';
import type { Browser, BrowserContext } from 'playwright-core';
import { resolve } from 'node:path';

export interface BrowserConfig {
  headless?: boolean;
  proxy?: string;
  binaryPath?: string;
  licenseKey?: string;
  userDataDir?: string;
}

export class BrowserLauncher {
  private static instance: BrowserLauncher | null = null;
  private browser: Browser | null = null;

  public static getInstance(): BrowserLauncher {
    if (!BrowserLauncher.instance) {
      BrowserLauncher.instance = new BrowserLauncher();
    }
    return BrowserLauncher.instance;
  }

  /**
   * Launches or returns a singleton CloakBrowser instance.
   */
  public async getBrowser(config: BrowserConfig = {}): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    const headless = config.headless ?? (process.env['HEADLESS'] !== 'false');
    const binaryPath =
      config.binaryPath ?? process.env['CLOAKBROWSER_BINARY_PATH'];
    const proxy = config.proxy ?? process.env['PROXY'];

    const launchOpts: Record<string, unknown> = {};
    if (binaryPath) {
      launchOpts['executablePath'] = binaryPath;
    }

    const options: Parameters<typeof launch>[0] = {
      headless,
    };
    if (proxy) {
      options.proxy = proxy;
    }
    if (Object.keys(launchOpts).length > 0) {
      options.launchOptions = launchOpts;
    }

    this.browser = await launch(options);
    return this.browser;
  }

  /**
   * Launches a persistent browser context for a specific profile directory.
   */
  public async launchPersistent(
    profileDir: string,
    config: BrowserConfig = {},
  ): Promise<BrowserContext> {
    const headless = config.headless ?? (process.env['HEADLESS'] !== 'false');
    const binaryPath =
      config.binaryPath ?? process.env['CLOAKBROWSER_BINARY_PATH'];
    const proxy = config.proxy ?? process.env['PROXY'];

    const launchOpts: Record<string, unknown> = {};
    if (binaryPath) {
      launchOpts['executablePath'] = binaryPath;
    }

    const resolvedDir = resolve(profileDir);
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

    return await launchPersistentContext(options);
  }

  public async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }
  }
}
