/**
 * src/services/retry.ts
 *
 * Enforces the request-level retry budget defined in plan.md §4.9.
 * Hard caps:
 *   - <= 4 attempts total (initial call included)
 *   - <= 2 account rotations
 *   - <= 1 browser fallback
 *   - <= 60 seconds total wall clock
 */

import { RETRY_BUDGET_CONFIG } from './upstream-constants.js';
import type { GatewayError } from '../types/contracts.js';

export interface RetryBudgetState {
  attempts: number;
  rotations: number;
  browserFallbacks: number;
  startTime: number;
}

export class RequestRetryBudget {
  private readonly maxAttempts: number;
  private readonly maxRotations: number;
  private readonly maxBrowserFallbacks: number;
  private readonly maxDurationMs: number;
  private readonly startTime: number;

  private attempts = 0;
  private rotations = 0;
  private browserFallbacks = 0;

  constructor(overrides?: Partial<typeof RETRY_BUDGET_CONFIG>) {
    this.maxAttempts = overrides?.maxAttempts ?? RETRY_BUDGET_CONFIG.maxAttempts;
    this.maxRotations = overrides?.maxRotations ?? RETRY_BUDGET_CONFIG.maxRotations;
    this.maxBrowserFallbacks =
      overrides?.maxBrowserFallbacks ?? RETRY_BUDGET_CONFIG.maxBrowserFallbacks;
    this.maxDurationMs =
      (overrides?.maxRetryDurationSec ?? RETRY_BUDGET_CONFIG.maxRetryDurationSec) * 1000;
    this.startTime = Date.now();
  }

  /**
   * Records a new execution attempt. Returns false if attempt budget exceeded.
   */
  public recordAttempt(): boolean {
    this.attempts++;
    return this.isWithinBudget();
  }

  /**
   * Records an account rotation. Returns false if rotation budget exceeded.
   */
  public recordRotation(): boolean {
    this.rotations++;
    return this.rotations <= this.maxRotations && this.isWithinBudget();
  }

  /**
   * Records a browser fallback. Returns false if fallback budget exceeded.
   */
  public recordBrowserFallback(): boolean {
    this.browserFallbacks++;
    return (
      this.browserFallbacks <= this.maxBrowserFallbacks &&
      this.isWithinBudget()
    );
  }

  /**
   * Checks whether the request is still within overall time and attempt caps.
   */
  public isWithinBudget(): boolean {
    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.maxDurationMs) return false;
    if (this.attempts > this.maxAttempts) return false;
    return true;
  }

  /**
   * Evaluates if a given error should be retried.
   */
  public shouldRetry(error: GatewayError): boolean {
    if (!this.isWithinBudget()) return false;
    if (this.attempts >= this.maxAttempts) return false;

    // Fast-fail or escalate on unrecoverable auth / captcha without browser fallback
    if (error.kind === 'auth') return false;
    if (error.kind === 'captcha' && this.browserFallbacks >= this.maxBrowserFallbacks) {
      return false;
    }

    return true;
  }

  /**
   * Calculates next exponential backoff delay with jitter.
   */
  public getBackoffDelayMs(): number {
    const base = RETRY_BUDGET_CONFIG.baseDelayMs;
    const max = RETRY_BUDGET_CONFIG.maxDelayMs;
    const exp = Math.min(max, base * Math.pow(2, Math.max(0, this.attempts - 1)));
    const jitter = Math.random() * 0.3 * exp;
    return Math.floor(exp + jitter);
  }

  public getState(): RetryBudgetState {
    return {
      attempts: this.attempts,
      rotations: this.rotations,
      browserFallbacks: this.browserFallbacks,
      startTime: this.startTime,
    };
  }
}
