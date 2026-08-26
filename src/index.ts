/**
 * src/index.ts
 *
 * Project Qwen Gateway Server entry point.
 */

import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './server/app.js';

const port = Number.parseInt(process.env['PORT'] || '3000', 10);
const host = process.env['HOST'] || '0.0.0.0';

const app = createApp();

console.log(`[Qwen Gateway] Initializing server on ${host}:${port}...`);

serve(
  {
    fetch: app.fetch,
    port,
    hostname: host,
  },
  (info) => {
    console.log(`[Qwen Gateway] Listening on http://${info.address}:${info.port}`);
    console.log(`[Qwen Gateway] Ready for OpenAI-compatible completions.`);
  },
);
