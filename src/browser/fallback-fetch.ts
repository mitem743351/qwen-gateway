/**
 * src/browser/fallback-fetch.ts
 *
 * Fallback HTTP execution inside CloakBrowser page context (`page.evaluate(fetch(...))`).
 * Used when direct HTTP transport encounters WAF or captcha challenge.
 */

import type { Page } from 'playwright-core';

export interface BrowserFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface BrowserFetchResult {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  text: string;
}

export async function executeBrowserFetch(
  page: Page,
  url: string,
  options: BrowserFetchOptions = {},
): Promise<BrowserFetchResult> {
  return await page.evaluate(
    async ({
      targetUrl,
      fetchOpts,
    }: {
      targetUrl: string;
      fetchOpts: BrowserFetchOptions;
    }) => {
      const init: RequestInit = {
        method: fetchOpts.method || 'GET',
        headers: fetchOpts.headers || {},
        credentials: 'include',
      };
      if (fetchOpts.body !== undefined) {
        init.body = fetchOpts.body;
      }
      const resp = await fetch(targetUrl, init);

      const text = await resp.text();
      const headers: Record<string, string> = {};
      resp.headers.forEach((val, key) => {
        headers[key] = val;
      });

      return {
        status: resp.status,
        statusText: resp.statusText,
        headers,
        text,
      };
    },
    { targetUrl: url, fetchOpts: options },
  );
}
