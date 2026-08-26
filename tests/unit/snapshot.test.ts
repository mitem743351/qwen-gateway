import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface SnapshotModel {
  model_id: string;
  display_name: string;
  context_window: number;
  max_input_tokens: number | null;
  max_output_tokens: number;
  max_thinking_tokens?: number;
  supports_streaming: boolean;
  supports_non_streaming: boolean;
  supports_tools: boolean;
  supports_mcp: boolean;
  supports_plugins: boolean;
  supports_vision: boolean;
  supports_files: boolean;
  supports_image_generation: boolean;
  supports_audio: boolean;
  supports_reasoning: boolean;
  supports_structured_output: boolean;
  supports_web_search: boolean;
  evidence: string[];
  confidence: 'confirmed' | 'frontend-only' | 'inferred';
}

interface SnapshotFile {
  generated_at: string;
  source: string;
  models: SnapshotModel[];
}

describe('Model Catalog Snapshot (Research.md §16)', () => {
  const snapshotPath = resolve(__dirname, '../../config/qwen-models.snapshot.json');
  const snapshot: SnapshotFile = JSON.parse(readFileSync(snapshotPath, 'utf-8'));

  it('contains exactly the 6 researched models', () => {
    expect(snapshot.models).toHaveLength(6);
    const ids = snapshot.models.map((m) => m.model_id);
    expect(ids).toEqual([
      'qwen3.7-plus',
      'qwen3.8-max',
      'qwen3.7-max',
      'qwen3.6-plus',
      'qwen3.5-plus',
      'qwen3.5-omni-plus',
    ]);
  });

  it('matches context windows and output limits from Research.md §16', () => {
    const byId = new Map(snapshot.models.map((m) => [m.model_id, m]));

    const plus37 = byId.get('qwen3.7-plus');
    expect(plus37).toBeDefined();
    expect(plus37?.context_window).toBe(1000000);
    expect(plus37?.max_output_tokens).toBe(65536);
    expect(plus37?.supports_reasoning).toBe(true);

    const max38 = byId.get('qwen3.8-max');
    expect(max38).toBeDefined();
    expect(max38?.context_window).toBe(1000000);
    expect(max38?.max_output_tokens).toBe(131072);
    expect(max38?.supports_reasoning).toBe(true);

    const max37 = byId.get('qwen3.7-max');
    expect(max37).toBeDefined();
    expect(max37?.context_window).toBe(1000000);
    expect(max37?.max_output_tokens).toBe(65536);
    expect(max37?.max_thinking_tokens).toBe(81920);
    expect(max37?.supports_vision).toBe(false);

    const omni = byId.get('qwen3.5-omni-plus');
    expect(omni).toBeDefined();
    expect(omni?.context_window).toBe(262144);
    expect(omni?.max_output_tokens).toBe(65536);
    expect(omni?.supports_reasoning).toBe(false);
  });

  it('verifies streaming and non-streaming flags across all models', () => {
    for (const m of snapshot.models) {
      expect(m.supports_streaming).toBe(true);
      expect(m.supports_non_streaming).toBe(false);
      expect(m.confidence).toBe('confirmed');
      expect(m.evidence.length).toBeGreaterThanOrEqual(2);
    }
  });
});
