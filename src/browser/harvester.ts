/**
 * src/browser/harvester.ts
 *
 * Harvests authentication cookies and Alibaba Baxia token trios from
 * a CloakBrowser page context via request interception.
 */

import type { BrowserContext, Page, Request } from 'playwright-core';
import type { SessionData } from '../services/session/session-service.js';

export interface HarvestedData {
  cookies: Record<string, string>;
  token?: string;
  baxiaTrio?: {
    bxUa: string;
    bxUmidtoken: string;
    bxV: string;
  };
  capturedHeaders?: Record<string, string>;
}

export class ProfileHarvester {
  /**
   * Attaches request interception to capture outbound API request headers
   * and Baxia tokens made by chat.qwen.ai.
   */
  public static async harvestPage(
    page: Page,
    context: BrowserContext,
    accountId: string,
  ): Promise<HarvestedData> {
    const capturedHeaders: Record<string, string> = {};
    let baxiaTrio: HarvestedData['baxiaTrio'] | undefined;

    // Listen for requests to /api/
    page.on('request', (req: Request) => {
      const url = req.url();
      if (url.includes('/api/')) {
        const headers = req.headers();
        for (const [key, val] of Object.entries(headers)) {
          if (typeof val === 'string') {
            capturedHeaders[key.toLowerCase()] = val;
          }
        }

        const bxUa = headers['bx-ua'];
        const bxUmid = headers['bx-umidtoken'];
        const bxV = headers['bx-v'];

        if (bxUa && bxUmid && bxV) {
          baxiaTrio = {
            bxUa,
            bxUmidtoken: bxUmid,
            bxV,
          };
        }
      }
    });

    // Harvest all cookies
    const allCookies = await context.cookies();
    const cookieRecord: Record<string, string> = {};
    let token: string | undefined;

    for (const c of allCookies) {
      cookieRecord[c.name] = c.value;
      if (c.name === 'token') {
        token = c.value;
      }
    }

    const result: HarvestedData = {
      cookies: cookieRecord,
      capturedHeaders,
    };
    if (token !== undefined) {
      result.token = token;
    }
    if (baxiaTrio !== undefined) {
      result.baxiaTrio = baxiaTrio;
    }

    return result;
  }

  /**
   * Converts harvested cookies into SessionData format.
   */
  public static toSessionData(
    accountId: string,
    harvested: HarvestedData,
  ): SessionData {
    const session: SessionData = {
      accountId,
      cookies: harvested.cookies,
      updatedAt: Date.now(),
      status: 'active',
    };
    if (harvested.token !== undefined) {
      session.token = harvested.token;
    }
    return session;
  }
}
