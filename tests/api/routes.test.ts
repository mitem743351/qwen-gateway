import { describe, it, expect, beforeEach } from 'vitest';
import { createApp } from '../../src/server/app.js';
import { DefaultQwenClient } from '../../src/services/qwen-client.js';

describe('OpenAI Gateway Routes (plan.md §7 Phase 4)', () => {
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    const mockClient = new DefaultQwenClient({ transportMode: 'mock' });
    app = createApp({ client: mockClient });
  });

  it('serves GET /healthz with registry drift and pool status', async () => {
    const res = await app.request('/healthz');
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      status: string;
      registry_drift: boolean;
      pool_status: unknown[];
    };
    expect(json.status).toBe('ok');
    expect(typeof json.registry_drift).toBe('boolean');
    expect(Array.isArray(json.pool_status)).toBe(true);
  });

  it('serves GET /v1/models listing the snapshot models in OpenAI format', async () => {
    const res = await app.request('/v1/models');
    expect(res.status).toBe(200);

    const json = (await res.json()) as {
      object: string;
      data: Array<{ id: string; object: string }>;
    };
    expect(json.object).toBe('list');
    expect(json.data.length).toBeGreaterThanOrEqual(6);
    expect(json.data.some((m) => m.id === 'qwen3.7-plus')).toBe(true);
  });

  it('handles non-streaming POST /v1/chat/completions (local aggregation)', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.7-plus',
        messages: [{ role: 'user', content: 'Say hi!' }],
        stream: false,
      }),
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      id: string;
      object: string;
      choices: Array<{
        message: { content: string; reasoning_content: string | null };
      }>;
      usage?: { total_tokens: number };
    };

    expect(json.object).toBe('chat.completion');
    expect(json.choices[0]?.message.content).toContain('Mock Qwen Response');
    expect(json.usage?.total_tokens).toBeGreaterThan(0);
  });

  it('handles streaming POST /v1/chat/completions with SSE framing', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.7-plus',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const text = await res.text();
    expect(text).toContain('data:');
    expect(text).toContain('chat.completion.chunk');
    expect(text).toContain('[DONE]');
  });

  it('enforces text-only content in v1 (rejects image_url with clear 400)', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'qwen3.7-plus',
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Analyze this' },
              {
                type: 'image_url',
                image_url: { url: 'https://example.com/photo.jpg' },
              },
            ],
          },
        ],
      }),
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toContain('Image inputs are not supported in v1');
  });

  it('returns clean 404 model_not_found for unknown model IDs', async () => {
    const res = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'unknown-quantum-model-9000',
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as { error: { code: string } };
    expect(json.error.code).toBe('model_not_found');
  });

  it('enforces API key authentication when API_KEYS is set', async () => {
    process.env['API_KEYS'] = 'secret-key-1,secret-key-2';
    const authedApp = createApp({
      client: new DefaultQwenClient({ transportMode: 'mock' }),
    });

    // Unauthenticated request to /v1/models should be rejected
    const unauthedRes = await authedApp.request('/v1/models');
    expect(unauthedRes.status).toBe(401);

    // Authenticated request with valid key should succeed
    const authedRes = await authedApp.request('/v1/models', {
      headers: { Authorization: 'Bearer secret-key-1' },
    });
    expect(authedRes.status).toBe(200);

    // Clean up env
    delete process.env['API_KEYS'];
  });
});
