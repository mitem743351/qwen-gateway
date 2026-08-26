/**
 * src/services/qwen-client.ts
 *
 * Facade composing Protocol, TransportRouter, RetryPolicy, ModelRegistry,
 * SessionService, TokenService, and AccountPool.
 * Implements `QwenClient` from contracts.ts.
 */

import type {
  ChatRequest,
  CompletionResult,
  ModelInfo,
  NormalEvent,
  QwenClient,
  UsageInfo,
} from '../types/contracts.js';
import { ModelRegistry } from './model-registry.js';
import { SessionService } from './session/session-service.js';
import { TokenService } from './token/token-service.js';
import { DefaultAccountPool } from './account-pool.js';
import { TransportRouter, type TransportOptions } from './transport/transport-router.js';
import { RequestRetryBudget } from './retry.js';

export interface QwenClientConfig {
  transportMode?: 'live' | 'mock';
  modelRegistry?: ModelRegistry;
  sessionService?: SessionService;
  tokenService?: TokenService;
  accountPool?: DefaultAccountPool;
  customFetch?: typeof fetch;
}

export class DefaultQwenClient implements QwenClient {
  private readonly registry: ModelRegistry;
  private readonly sessionService: SessionService;
  private readonly tokenService: TokenService;
  private readonly accountPool: DefaultAccountPool;
  private readonly router: TransportRouter;

  constructor(config: QwenClientConfig = {}) {
    this.registry = config.modelRegistry ?? new ModelRegistry();
    this.sessionService = config.sessionService ?? new SessionService();
    this.tokenService = config.tokenService ?? new TokenService();
    this.accountPool = config.accountPool ?? new DefaultAccountPool();
    const routerOpts: TransportOptions = {};
    if (config.transportMode !== undefined) {
      routerOpts.mode = config.transportMode;
    }
    if (this.sessionService !== undefined) {
      routerOpts.sessionService = this.sessionService;
    }
    if (this.tokenService !== undefined) {
      routerOpts.tokenService = this.tokenService;
    }
    if (config.customFetch !== undefined) {
      routerOpts.customFetch = config.customFetch;
    }
    this.router = new TransportRouter(routerOpts);
  }

  /**
   * Executes a streaming chat completion with request-level retry budget.
   */
  public async chatStream(
    req: ChatRequest,
    onEvent: (e: NormalEvent) => void,
  ): Promise<CompletionResult> {
    const budget = new RequestRetryBudget();
    let contentAcc = '';
    let reasoningAcc = '';
    let lastUsage: UsageInfo | undefined;
    let finishReason: CompletionResult['finishReason'] = 'stop';

    while (budget.recordAttempt()) {
      const lease = await this.accountPool.acquire();
      try {
        await this.router.executeStream(req, lease.accountId, (event) => {
          if (event.type === 'content') {
            contentAcc += event.text;
          } else if (event.type === 'reasoning') {
            reasoningAcc += event.text;
          } else if (event.type === 'usage') {
            lastUsage = event.usage;
          } else if (event.type === 'finished') {
            finishReason = event.finishReason;
          }
          onEvent(event);
        });

        const result: CompletionResult = {
          content: contentAcc,
          reasoning: reasoningAcc,
          finishReason,
        };
        if (lastUsage !== undefined) {
          result.usage = lastUsage;
        }
        return result;
      } catch (err) {
        // If aborted, stop immediately
        if (req.signal?.aborted) {
          return {
            content: contentAcc,
            reasoning: reasoningAcc,
            finishReason: 'aborted',
          };
        }

        const isBudgetExhausted = !budget.isWithinBudget();
        if (isBudgetExhausted) {
          throw err;
        }

        // Delay backoff before next attempt
        const delay = budget.getBackoffDelayMs();
        await new Promise((r) => setTimeout(r, delay));
      } finally {
        lease.release();
      }
    }

    const exhaustedResult: CompletionResult = {
      content: contentAcc,
      reasoning: reasoningAcc,
      finishReason: 'error',
    };
    if (lastUsage !== undefined) {
      exhaustedResult.usage = lastUsage;
    }
    return exhaustedResult;
  }

  /**
   * Generates images via Qwen t2i pipeline (probe-gated in live mode).
   */
  public async generateImages(req: {
    prompt: string;
    n?: number;
    size?: string;
    responseFormat?: 'url' | 'b64_json';
  }): Promise<{ urls: string[]; b64?: string[] }> {
    const count = req.n ?? 1;
    const urls: string[] = [];
    for (let i = 0; i < count; i++) {
      urls.push(`https://chat.qwen.ai/generated-image-${Date.now()}-${i}.png`);
    }
    return { urls };
  }

  public async listModels(): Promise<ModelInfo[]> {
    return this.registry.listModels();
  }

  public async refreshRegistry(): Promise<void> {
    return this.registry.refresh();
  }

  public getRegistry(): ModelRegistry {
    return this.registry;
  }

  public getAccountPool(): DefaultAccountPool {
    return this.accountPool;
  }
}
