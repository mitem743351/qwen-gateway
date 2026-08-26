/**
 * src/services/model-registry.ts
 *
 * Model catalog management, snapshot seeding, live sync with /api/v2/models/,
 * and drift detection per plan.md §5.
 */

import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import type { ModelCapabilities, ModelInfo } from '../types/contracts.js';
import type { OpenAIModelCard, OpenAIModelList } from '../types/openai.js';
import type { WireModel } from '../types/qwen.js';
import { UPSTREAM_ENDPOINTS, COMMON_UPSTREAM_HEADERS } from './upstream-constants.js';

interface SnapshotModelEntry {
  model_id: string;
  display_name: string;
  context_window: number;
  max_output_tokens: number;
  max_thinking_tokens?: number;
  supports_vision: boolean;
  supports_files: boolean;
  supports_audio: boolean;
  supports_reasoning: boolean;
  supports_web_search: boolean;
  supports_image_generation: boolean;
  supports_tools: boolean;
  supports_mcp: boolean;
  confidence: 'confirmed' | 'frontend-only' | 'inferred';
}

interface SnapshotFile {
  generated_at: string;
  source: string;
  models: SnapshotModelEntry[];
}

export class ModelRegistry {
  private models = new Map<string, ModelInfo>();
  private driftDetected = false;
  private lastSyncedAt: number = 0;
  private readonly snapshotPath: string;
  private readonly driftLogPath: string;
  private readonly allowUnknownModels: boolean;

  constructor(options?: {
    snapshotPath?: string;
    driftLogPath?: string;
    allowUnknownModels?: boolean;
  }) {
    this.snapshotPath =
      options?.snapshotPath ??
      resolve(process.cwd(), 'config/qwen-models.snapshot.json');
    this.driftLogPath =
      options?.driftLogPath ?? resolve(process.cwd(), 'data/drift.log');
    this.allowUnknownModels =
      options?.allowUnknownModels ??
      (process.env['ALLOW_UNKNOWN_MODELS'] === 'true');

    this.loadSnapshot();
  }

  /**
   * Loads seed models from config/qwen-models.snapshot.json.
   */
  public loadSnapshot(): void {
    if (!existsSync(this.snapshotPath)) {
      return;
    }

    try {
      const content = readFileSync(this.snapshotPath, 'utf-8');
      const data: SnapshotFile = JSON.parse(content);

      for (const entry of data.models) {
        const capabilities: ModelCapabilities = {
          vision: Boolean(entry.supports_vision),
          documents: Boolean(entry.supports_files),
          videoInput: false,
          audioInput: Boolean(entry.supports_audio),
          reasoning: Boolean(entry.supports_reasoning),
          thinkSkip: true,
          webSearch: Boolean(entry.supports_web_search),
          imageGeneration: Boolean(entry.supports_image_generation),
          tools: Boolean(entry.supports_tools),
          mcp: Boolean(entry.supports_mcp),
        };

        const chatTypes = ['t2t'];
        if (entry.supports_image_generation) chatTypes.push('t2i');
        if (entry.supports_web_search) chatTypes.push('search');

        const modelInfo: ModelInfo = {
          id: entry.model_id,
          displayName: entry.display_name,
          contextWindow: entry.context_window,
          maxOutputTokens: entry.max_output_tokens,
          capabilities,
          chatTypes,
          source: 'snapshot',
          confidence: entry.confidence,
        };

        if (entry.max_thinking_tokens !== undefined) {
          modelInfo.maxThinkingTokens = entry.max_thinking_tokens;
        }

        this.models.set(entry.model_id, modelInfo);
      }
    } catch (err) {
      console.error('Failed to load model snapshot:', err);
    }
  }

  /**
   * Refreshes model catalog by querying live GET /api/v2/models/
   */
  public async refresh(customFetch?: typeof fetch): Promise<void> {
    const doFetch = customFetch ?? fetch;
    try {
      const res = await doFetch(UPSTREAM_ENDPOINTS.models, {
        method: 'GET',
        headers: COMMON_UPSTREAM_HEADERS,
      });

      if (!res.ok) {
        console.warn(
          `Live model sync failed with status ${res.status}; maintaining existing registry.`,
        );
        return;
      }

      const json = (await res.json()) as {
        success?: boolean;
        data?: { data?: WireModel[] };
      };
      const wireModels = json.data?.data;
      if (!Array.isArray(wireModels)) return;

      this.mergeLiveModels(wireModels);
      this.lastSyncedAt = Date.now();
    } catch (err) {
      console.warn('Network error during model refresh:', err);
    }
  }

  private mergeLiveModels(wireModels: WireModel[]): void {
    const observedIds = new Set<string>();

    for (const wm of wireModels) {
      if (!wm.id) continue;
      observedIds.add(wm.id);

      const meta = wm.info?.meta;
      const contextWindow = meta?.max_context_length ?? 1000000;
      const maxOutput =
        meta?.max_summary_generation_length ??
        meta?.max_generation_length ??
        65536;
      const maxThinking = meta?.max_thinking_generation_length;

      const caps = meta?.capabilities;
      const capabilities: ModelCapabilities = {
        vision: Boolean(caps?.vision),
        documents: Boolean(caps?.document),
        videoInput: Boolean(caps?.video),
        audioInput: Boolean(caps?.audio),
        reasoning: Boolean(caps?.thinking),
        thinkSkip: Boolean(meta?.think_skip?.enable),
        webSearch: Boolean(caps?.search),
        imageGeneration: meta?.chat_type?.includes('t2i') ?? true,
        tools: true,
        mcp: true,
      };

      const existing = this.models.get(wm.id);
      if (!existing) {
        this.recordDrift(`New model discovered live: ${wm.id}`);
      } else {
        if (existing.contextWindow !== contextWindow) {
          this.recordDrift(
            `Model ${wm.id} context window changed from ${existing.contextWindow} to ${contextWindow}`,
          );
        }
        if (existing.maxOutputTokens !== maxOutput) {
          this.recordDrift(
            `Model ${wm.id} max output changed from ${existing.maxOutputTokens} to ${maxOutput}`,
          );
        }
      }

      const merged: ModelInfo = {
        id: wm.id,
        displayName: existing?.displayName ?? wm.id,
        contextWindow,
        maxOutputTokens: maxOutput,
        capabilities,
        chatTypes: meta?.chat_type ?? existing?.chatTypes ?? ['t2t'],
        source: 'live',
        confidence: 'confirmed',
      };
      if (maxThinking !== undefined) {
        merged.maxThinkingTokens = maxThinking;
      }

      this.models.set(wm.id, merged);
    }
  }

  private recordDrift(message: string): void {
    this.driftDetected = true;
    const line = `[${new Date().toISOString()}] DRIFT: ${message}\n`;
    try {
      const dir = dirname(this.driftLogPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      appendFileSync(this.driftLogPath, line, 'utf-8');
    } catch {
      // Best-effort drift logging
    }
    console.warn(`[ModelRegistry] ${message}`);
  }

  public getModel(id: string): ModelInfo | undefined {
    const model = this.models.get(id);
    if (model) return model;

    if (this.allowUnknownModels) {
      // Pass-through inference for day-one unlisted models
      const inferred: ModelInfo = {
        id,
        displayName: id,
        contextWindow: 1000000,
        maxOutputTokens: 65536,
        capabilities: {
          vision: false,
          documents: false,
          videoInput: false,
          audioInput: false,
          reasoning: true,
          thinkSkip: true,
          webSearch: true,
          imageGeneration: false,
          tools: true,
          mcp: true,
        },
        chatTypes: ['t2t'],
        source: 'snapshot',
        confidence: 'inferred',
      };
      return inferred;
    }

    return undefined;
  }

  public listModels(): ModelInfo[] {
    return Array.from(this.models.values());
  }

  /**
   * Converts internal model registry to OpenAI list schema
   */
  public toOpenAIList(): OpenAIModelList {
    const createdTimestamp =
      this.lastSyncedAt > 0 ? Math.floor(this.lastSyncedAt / 1000) : 1771977600;

    const data: OpenAIModelCard[] = this.listModels().map((m) => ({
      id: m.id,
      object: 'model',
      created: createdTimestamp,
      owned_by: 'qwen',
    }));

    return {
      object: 'list',
      data,
    };
  }

  public hasDrift(): boolean {
    return this.driftDetected;
  }
}
