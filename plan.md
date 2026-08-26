# Project Qwen — plan.md (v2.1, audit revision 2026-08-25)

> **Mission:** Build a self-hosted gateway that turns **https://chat.qwen.ai** web capabilities into
> **OpenAI-compatible API-level capabilities**, using **CloakBrowser** (installed via `npm install cloakbrowser`)
> as the stealth browser layer.
>
> **This document is the build instruction for two AI agents working in parallel** (Agent A = "Core",
> Agent B = "Surface"). Each phase lists exact deliverables, file ownership, and sync points.
>
> **Protocol baseline:** `Research.md` (live discovery, 2026-08-25, app version `0.4.4`, frontend bundle `0.2.87`,
> executed through CloakBrowser Chromium v146). Where `Research.md` conflicts with anything in `References/`,
> **Research.md wins**; the reference repos describe an older protocol snapshot.
>
> Platform target: **Windows x64 (this machine)**, Node.js ≥ 20, TypeScript. Everything runs locally; no Docker required for v1 (add later if wanted).

---

## 0. Ground rules for both agents

1. **Read this whole file plus `Research.md` before writing any code.** Implement the plan; no wholesale re-architecture. Exception: during **Phase 0–1**, shared contracts (`src/types/**`, constants) may be refined when `[NET]`/`[RUN]` evidence requires it — every such change gets a `COORDINATION.md` note before code depends on it.
2. **Evidence discipline.** Every protocol fact implemented must carry one of these tags, and the tag travels into code comments/constants:
   - `[NET]` — confirmed by captured network traffic (highest trust),
   - `[RUN]` — confirmed by executing a live completion,
   - `[FE]` — frontend-bundle-only evidence (exists in the web app, wire behavior unverified),
   - `[INF]` — inferred (e.g., derived limits).
   Never implement a `[FE]`/`[INF]` assumption as if it were `[NET]`.
3. **Never edit files owned by the other agent** (ownership table in §9). Shared contract files live in `src/types/` and may only be changed per ground rule 1's Phase 0–1 evidence exception, announced in `COORDINATION.md`.
4. **Every agent appends progress notes to `COORDINATION.md`** (one block per completed task): what was built, deviations from plan, open questions.
5. **No secrets in code.** Cookies/tokens/accounts go into `.env` or `data/` (gitignored).
6. Personal use only, single instance; do not resell as a public service.
7. When blocked on an ambiguity not answered by this plan or `Research.md`, follow the resolution recorded in §11 (Contradiction ledger); if not listed there, choose the option backed by `[NET]` evidence and log the decision in `COORDINATION.md`.

---

## 1. Sources and what each teaches

| Source | Type | Why it matters | Caveats |
|---|---|---|---|
| **`Research.md`** | Live discovery 2026-08-25 | **Authoritative.** Model catalog (`/api/v2/models/`), limits, request/response schemas, multi-phase SSE protocol with `response.created` framing and streamed `usage`, thinking modes, tools/MCP surface, file pipeline | Authenticated session only — guest mode untouched; some items `[FE]`-only |
| `References/qwen2api-master/core.js` | Older working impl | Fallback shapes, retry ladder, baxia/wu.json fallback chain, WAF/`rgv587` error taxonomy, OSS upload signing details | **Outdated:** `version: '0.2.83'` header (value itself now suspect — see §4), `chat_mode:'guest'`, `title` field in `chats/new`, `/api/models` endpoint, no `response.created`/`usage` handling |
| `References/qwengate-dev` | Older impl + ops notes | `HANDOFF.md` fat-session lesson (full cookie jar required), pure-JS bx-ua format, settings payload to disable tools/memory per account, OSS V4 canonical request | Uses `/api/models` and `GET getstsToken` (research shows `/api/v2/models/`, `POST`) |
| `References/qwen2api-rs-main`, `qwenproxy-main`, `QwenChat2Api-main` | Older impls | Account pool patterns, cooldowns, tool-calling via injection, metrics ideas | Same protocol-era caveats |
| `References/qwen-free-api-master`, `qwen2API-main` | Legacy / roadmap | Historical only; Go project = post-v1 product-scope inspiration | Ignore for protocol |

---

## 2. CloakBrowser — how we use it

Installed already: `npm install cloakbrowser`. Drop-in Playwright replacement backed by a stealth-patched Chromium binary (auto-downloads to `~/.cloakbrowser/`). `Research.md` was itself gathered **through CloakBrowser Chromium v146 against chat.qwen.ai**, which de-risks this layer.

```js
import { launch, launchPersistentContext } from 'cloakbrowser';

const browser = await launch({ headless: true, humanize: true });
const page = await browser.newPage();

const ctx = await launchPersistentContext({
  userDataDir: './data/profiles/<account-id>',
  headless: true,
  proxy: 'http://user:pass@host:port', // optional
  geoip: true,
  humanize: true,
});
```

Key options: `proxy`, `geoip`, `headless`, `humanize`, `launchOptions`, `userDataDir`, license via `CLOAKBROWSER_LICENSE_KEY`.

### Role: "browser farms the session, HTTP does the work"

1. **Session bootstrap / login:** open `chat.qwen.ai` in a persistent profile; capture the **full cookie jar** (JWT `token=` plus WAF cookies `cna`, `ssxmod_itna`, `tfstk`, `isg`, `x5sec`) and localStorage. Persist per account (qwengate HANDOFF: thin sessions trigger `FAIL_SYS_USER_VALIDATE`).
2. **Session health check `[NET]`:** `GET /api/v1/auths/` returns user/role — use it (plus `POST /api/v2/users/status` heartbeat) to validate sessions cheaply instead of page scraping. On logout/expiry flag `needs_login` (headed mode + `humanize:true` for manual login).
3. **Baxia header harvesting:** inside the logged-in page context wait for Aliyun baxia init, then extract `bx-ua`/`bx-umidtoken`/`bx-v`. Preferred route: **intercept outgoing requests the page itself makes and copy the trio** (robust against fireyejs obfuscation); JS-global inspection as secondary. Cache ~15–25 min, proactive refresh. Fallback chain: harvested → `sg-wum.alibaba.com/w/wu.json` umid token → synthetic (per qwen2api-master).
4. **Warm/fallback transport:** primary chat traffic over plain `fetch` reusing fat cookies + baxia headers. On WAF/captcha replies, retry through the CloakBrowser page context (`page.evaluate(fetch(...))`); if that succeeds, mark HTTP path degraded and re-harvest.
5. Windows notes: headless default; keep `HEADLESS=false` toggle. Force binary download in the Phase 1 smoke test, not lazily mid-test-suite.

---

## 3. Target architecture

```
OpenAI SDK clients (curl, Claude Code, Cursor, …)
        │  POST /v1/chat/completions  (stream=true|false)
        │  GET  /v1/models · POST /v1/images/generations
        ▼
┌──────────────────────────────────────────────────┐
│  Agent B — API Surface (Hono or Express)         │
│  routing · OpenAI schema validation · SSE writer │
│  stream=false aggregation (upstream is SSE-only) │
│  API-key auth · admin UI · config · SQLite       │
└──────────────┬───────────────────────────────────┘
               │ internal service interfaces (src/types/contracts.ts)
┌──────────────▼───────────────────────────────────┐
│  Agent A — Upstream Core (layered, not monolithic)│
│  protocol/  QwenProtocol (payload builders, SSE   │
│    parser → NormalEvent[], error classification)  │
│  transport/ TransportRouter (http-first + browser │
│    fallback decisioning) · retry policy (budget §4.9)
│  session/   SessionService (CloakBrowser profiles,│
│    fat cookie harvest, login, /api/v1/auths/)     │
│  token/     TokenService (bx-ua/bx-umidtoken cache)│
│  registry/  ModelRegistry (live sync + snapshot + │
│    drift detection)                               │
│  upload/ UploadService · pool/ AccountPool        │
│  QwenClient = thin façade composing the above; it │
│  owns no parsing/routing/retry logic itself       │
└──────────────┬───────────────────────────────────┘
               │ HTTPS (HTTP/2 observed at runtime, not guaranteed) + harvested cookies/headers
        chat.qwen.ai  (account mode primary · guest mode probe-gated)
```

**Two protocol facts that shape everything (both `[NET]`/`[RUN]`):**
- Upstream completions are **SSE-only** (`supports_non_streaming: false` for every model). Our `stream=false` is always *local aggregation* of an upstream stream — there is no monolithic upstream call to make.
- `usage` arrives **incrementally inside every SSE chunk** (cumulative counters) — real token accounting is free; no estimation needed for v1.

**Auth modes:**
- **Account mode (primary)** — N logged-in accounts via persistent CloakBrowser profiles; round-robin/least-load rotation, cooldowns; `chat_mode: 'normal'` `[NET]`.
- **Guest mode (probe-gated fallback)** — the reference repos used `chat_mode:'guest'`, but `Research.md` never tested it. Keep the code path; gate behind a Phase 2 probe result and `GUEST_MODE` env (default `false`). Zero-config promise only survives if the probe passes.

**Tech stack:** Node.js ≥ 20, TypeScript (ESM), `hono` (or express), global fetch/undici for upstream calls (HTTPS required; HTTP/2 negotiation is observed/logged, not guaranteed — see §4), better-sqlite3, vitest, tsx.

**Repo layout (updated for layered services):**

```
G:\Project Qwen\
├─ plan.md · Research.md · COORDINATION.md · .env.example
├─ package.json / tsconfig.json
├─ config\qwen-models.snapshot.json   ← seeded from Research.md §16 (A owns)
└─ src\
   ├─ index.ts (B) · server\ (B) routes/middleware/sse-writer/admin
   ├─ services\ (A) protocol/, transport/, retry.ts, session/, token/,
   │                qwen-client.ts (façade), upload.ts, account-pool.ts,
   │                model-registry.ts, upstream-constants.ts
   ├─ browser\ (A) launch.ts, profile.ts, harvester.ts, fallback-fetch.ts
   ├─ types\ (SHARED) contracts.ts, openai.ts, qwen.ts
   └─ utils\ · tests\unit (A) · tests/api (B) · scripts\
```

---

## 4. Upstream protocol cheat sheet (v2 — evidence-tagged)

Base `https://chat.qwen.ai` over **HTTPS** (HTTP/2 is what the research session observed on the wire, but it is a runtime property of the negotiated connection — do not hardcode or assert it; log the negotiated protocol for diagnostics). Common headers every call: realistic Chrome UA + `Accept-Language`, `source: web`, `Origin`/`Referer: https://chat.qwen.ai/`, `x-request-id: <uuid>`, baxia trio (`bx-ua`, `bx-umidtoken`, `bx-v`), full fat `Cookie` jar.

**`version` request header — UNKNOWN, do not guess.** The reference repos pinned `0.2.83`; `Research.md` reports app version `0.4.4` and frontend bundle version `0.2.87`, but there is **no captured evidence that any specific value is required in an outbound API request header**, nor which component the header tracks. Policy:
- Treat the actual header value as an open question resolved only by **live capture**: Phase 1 baxia harvester already intercepts page-originated requests — record the exact `version` (and any sibling headers) the real web client sends on `/api/v2/chats/new` and `/api/v2/chat/completions`.
- Until captured, send no `version` header at all (its absence is more honest than a fabricated value) unless capture proves otherwise.
- After capture, store it in `upstream-constants.ts` with its `[NET]` provenance and re-validate via the §5 probe.

1. **Create conversation** `POST /api/v2/chats/new` `[NET]` — researched (account mode) body:
   `{ chatId:"", models:[model], project_id:"", timestamp, chat_type:"t2t", chat_mode:"normal" }`
   Legacy variant in old refs (`title:"新建对话"`, `chat_mode:"guest"`) — keep as fallback if the researched shape is rejected. Retry on create is bounded by the §4.9 budget, rotating baxia tokens between attempts; `rgv587`/risk-control retryable. Response `data.id` = chatId.
2. **Chat completion** `POST /api/v2/chat/completions?chat_id={id}` `[NET]` — body (supersedes old core.js shape):
   ```jsonc
   {
     "stream": true, "version": "2.1", "incremental_output": true,
     "chatId": "<id>", "chat_id": "<id>",           // both keys present in captured request
     "parentId": "", "parent_id": null,             // both spellings present
     "chat_mode": "normal", "model": "<model>",
     "messages": [{
       "id": null, "fid": "<uuid>", "parentId": null, "childrenIds": [],
       "role": "user", "content": "...",
       "chat_type": "t2t",
       "model": "<model>",                          // message.model = target model (old refs sent "")
       "status": "completed", "user_action": "chat", "contentType": "text", "files": [],
       "feature_config": {
         "thinking_enabled": true, "output_schema": "phase", "instructions": null,
         "research_mode": "normal", "auto_thinking": true,
         "thinking_mode": "Auto",                   // Auto | Thinking | Fast  [NET]
         "thinking_format": "summary",
         "auto_search": false                       // v1 forces false for determinism
       }
     }],
     "timestamp": <ms>
   }
   ```
3. **SSE stream structure** `[RUN]` — `text/event-stream; charset=utf-8`, line-framed `data:` JSON:
   - **First event:** `{"response.created":{"chat_id","parent_id","response_id","response_index"}}` — new vs old refs; parser must expect it (and tolerate its absence).
   - **Content chunks:** `{"choices":[{"delta":{...}}],"response_id","usage"?,"timestamp"}`
     - Reasoning: `delta.phase="thinking_summary"`; text in `delta.extra.summary_thought.content` (**string array**) plus a separate title in `summary_title.content` (array) `[RUN]`. Keep title and body **distinct fields** through the whole protocol layer — only the OpenAI adapter decides presentation (e.g. prepending the title to `reasoning_content`). Old refs treated it as a single string — handle arrays.
     - Answer: `delta.phase="answer"`, incremental `delta.content`, `status:"typing"`.
     - Tool activity: `delta.phase="<tool_name>"` (e.g. `code_interpreter`) with `function_id`, `function_call{name,arguments}`, `status:"running"` `[NET]` — **parser must skip unknown phases gracefully** (log only), never crash. Normalized `tool` events must preserve `functionId`, tool name, arguments payload, and status verbatim so later phases lose nothing even though v1 does not execute tools.
     - Finish: `status:"finished"` on a final delta `[RUN]`.
   - **Usage:** cumulative per chunk `[RUN]`: `input_tokens`, `output_tokens`, `characters`, `total_tokens`, `input_tokens_details.text_tokens`, `output_tokens_details.{reasoning_tokens,text_tokens}`, `prompt_tokens_details.cached_tokens`. Take the last usage seen before `finished` as final.
4. **Stop generation** `POST /api/v2/chat/completions/stop` `[FE]` — use best-effort on client disconnect (body shape unverified; probe; closing our upstream connection is the guaranteed fallback).
5. **Models** `GET /api/v2/models/` `[NET]` (trailing slash; supersedes old `/api/models`) → `success / data.data[]`, each with `info.meta`: `capabilities{vision,document,video,audio,thinking,search}`, `max_context_length`, `max_summary_generation_length` (omni reportedly uses `max_generation_length` — read both keys), `max_thinking_generation_length` (when set), `abilities`, `chat_type[]`, `modality[]`, `think_skip.enable`. Feed the ModelRegistry (§5).
6. **Images (v1):** drive `chat_type:"t2i"` (present in every flagship model's catalog `chat_type[]` `[NET]`) through the same completion endpoint; map OpenAI `size`→ratio, extract URLs from `image_gen` phase events (old-ref behavior — re-verify on live probe). Dedicated image models `qwen-image-3.0-pro` / `qwen-image-2.0-pro` are `[FE]`-only — candidate backend behind a config flag, not the default path.
7. **Files (v1.5, corrected):** `POST /api/v2/files/getstsToken` `[FE]` (refs used GET) → OSS PUT (V4 sig per qwengate) → `POST /api/v2/files/parse` + `/parse/status` `[FE]`. Limits `[FE]`: docs/images ≤5×20MB per turn, video ≤2000MB/60min, audio ≤2000MB/180min.
8. **Error classes:** HTTP non-200; HTTP 200 `{success:false}`; WAF HTML (`aliyun_waf`); `FAIL_SYS_USER_VALIDATE` (captcha → escalate to browser transport); rate limits (backoff + rotate account).
9. **Request-level retry budget (hard caps, enforced in QwenClient — prevents retry storms):**
   - max attempts per request: **4** total (initial call included);
   - max account rotations per request: **2**;
   - max browser-transport fallbacks per request: **1** (browser fallback is the last rung, not a loop participant);
   - max wall-clock retry duration per request: **60s** across all attempts, then fail with the best-classified error.
   Backoff between attempts is exponential with jitter (e.g. 500ms → 1s → 2s). Every attempt consumes budget regardless of failure class; only clearly-retryable classes (`rate_limit`, transient `network`) may consume remaining budget — `captcha`/`auth` failures short-circuit to escalation/failure immediately. Caps live in `upstream-constants.ts`, overridable via env for load testing.

**Confirmed runtime vs frontend-only (do not blur):**
- `[NET]/[RUN]` confirmed: 6-model catalog, 1M/256K contexts, output caps (65,536 / 131,072), thinking modes Auto/Thinking/Fast, phase-schema SSE with `response.created`, streamed usage, `chat_mode:'normal'` schemas, tools/MCP existence. HTTP/2 was observed in the research session but as a transport observation only — not an API contract.
- `[FE]`-only (exists in app, wire behavior unverified — later phases, probe first): TTS (`/api/v2/tts/*`), stop-endpoint body, file parse endpoints' exact contracts, dedicated image model IDs, artifacts/web_dev/slides/deep_research chat types, MCP transports, search citation format (`[[1]]` + `extra.web_search_info`). The outbound `version` request header value is currently **unestablished by any evidence class** (see §4 policy).
- `[INF]`: max-input ceilings (~868K–~934K = context − output). Treat as advisory only; enforce nothing beyond context-window warnings in v1.

---

## 5. Capability registry & protocol drift detection (new)

Upstream ships new models and bumps versions without notice; the old plan hardcoded stale constants. Both agents build against a **registry**, not literals:

1. **Snapshot:** `config/qwen-models.snapshot.json` — seeded verbatim from `Research.md` §16 (6 models, limits, capability flags, per-entry `confidence` and `evidence`). Ship-of-theseus baseline; Agent A owns it.
2. **Live sync:** `ModelRegistry.refresh()` fetches `GET /api/v2/models/`, parses `info.meta`, merges over snapshot (live wins), records `source:'live'|'snapshot'` per field. If the endpoint is unavailable, serve snapshot degraded.
3. **Drift detection:** on refresh, diff live vs snapshot: new/removed model IDs, changed context/output caps, changed `capabilities` flags. Log warnings + append to `COORDINATION.md`-style drift log (`data/drift.log`); expose via `/healthz` detail (`registry_drift: true`). **Registration policy:** models present in the live upstream registry are registered dynamically (with `confidence:'confirmed'` when `[NET]`-fetched); an unknown model ID requested by a user that is absent from the registry returns a clean OpenAI-style 404 `model_not_found` error — **unless** `ALLOW_UNKNOWN_MODELS=true`, in which case it is admitted with `confidence:'inferred'` and passed through to upstream (useful for day-one model launches). Never silently accept-and-forget an unknown ID.
4. **Probe script:** `scripts/probe-protocol.ts` (Phase 2) re-validates cheaply on demand: actual outbound `version` header captured from page-originated requests (§4), models endpoint reachability, guest-mode viability, `chats/new` body-shape acceptance, stop-endpoint body, **live `t2i` round-trip incl. image URL extraction** (§6/§12 gate this), negotiated HTTP protocol. Output: PASS/FAIL table appended to coordination log. Run it whenever upstream behavior surprises us; it replaces guesswork.
5. **`/v1/models`** maps `ModelInfo[]` → OpenAI format (`object:'model'`, `owned_by:'qwen'`, `created` from registry timestamp). Unknown-to-OpenAI fields stay internal.
6. **`.env.example` addition:** `ALLOW_UNKNOWN_MODELS=false` (see §5.3).

---

## 6. Feature scope

**v1 (must ship — unchanged boundary):**
- `POST /v1/chat/completions` — stream + **aggregated non-stream** (upstream is SSE-only), multi-turn, system prompt, reasoning exposed as `reasoning_content` deltas (**title/text presentation mapping decided in the API adapter** — protocol layer keeps them separate per §4), real upstream `usage` in the final response/chunk, graceful abort/disconnect (best-effort stop endpoint + connection close).
- Optional `reasoning_effort` (contract values `none | low | medium | high`; OpenAI alias `minimal` accepted at the API edge and mapped to `none`): `none → thinking_enabled:false`, `low/medium(default) → Auto` `[NET]` mode, `high → Thinking` `[NET]` mode; document that Fast maps to `low` only if probe shows `think_skip` behaves.
- `GET /v1/models` from ModelRegistry (live + snapshot).
- `POST /v1/images/generations` via `t2i` chat type — **accepted as v1 deliverable only after the live `t2i` probe passes** (catalog support is confirmed `[NET]`, but image-URL extraction from the SSE stream still needs runtime verification per §11.4; if the probe fails, ship a clean 501 and move the endpoint to P2).
- Account mode (primary) + probe-gated guest mode; persistent profiles; fat-cookie + baxia harvesting; WAF browser-fallback; rotation/cooldowns; gateway API-key auth; `/healthz` with registry/session status; `.env` config.

**Explicitly NOT in v1** (each lands in a named later phase — do not pull forward):
- **P2-A Search & grounding** — `auto_search`, citations, `extra.web_search_info` (v1 forces `auto_search:false`).
- **P2-B Files & vision** — upload pipeline wired to chat, `image_url` inputs, document parsing (UploadService built in Phase 3 but only consumed from P2-B).
- **P2-C Tool calling** — prompt-injection + parser approach; native tool phases (`function_call` in SSE) only logged in v1.
- **P3 TTS** (`/api/v2/tts/*`), **P3 Audio/Video input** (Omni modality), **P3 MCP** (transports + managed servers), **P4 Artifacts/web_dev/slides/deep_research chat types**, **P4 Admin dashboard parity with qwen2API Go project**, structured-output constraints.

---

## 7. Phases and acceptance criteria

**Phase 0 — Bootstrap (both agents, half day)**
- [ ] Skeleton: `package.json` (type module), tsconfig, vitest, `.env.example` (`PORT`, `API_KEYS`, `ACCOUNTS_DIR=./data/profiles`, `GUEST_MODE=false`, `ALLOW_UNKNOWN_MODELS=false`, `HEADLESS=true`, `PROXY=`, `LOG_LEVEL`, `DEFAULT_MODEL=qwen3.7-plus`).
- [ ] `src/types/contracts.ts` committed from §8 verbatim; both agents review before branching.
- [ ] `config/qwen-models.snapshot.json` seeded from `Research.md` §16 (Agent A).
- [ ] `COORDINATION.md` initialized.
- Accept: `npm install && npx tsc --noEmit && npx vitest run` green on empty skeleton.

**Phase 1 — Browser foundation (Agent A) ← highest risk, first**
- [ ] `src/browser/*`: launcher wrapper (singleton mgmt, Windows paths, headless toggle, proxy/geoip), persistent-profile helper.
- [ ] `scripts/smoke-browser.ts`: launch → goto chat.qwen.ai → dump cookies + UA → close (run headed once to force binary download).
- [ ] Cookie harvester: full jar incl. `cna/ssxmod_itna/tfstk/isg/x5sec/token`; persistence to `data/profiles/<id>/cookies.json`.
- [ ] Baxia harvester: request-interception-first trio capture; **also record every outbound API request's exact header set** (esp. `version`, if present) to resolve the §4 open question; TTL cache + proactive refresh.
- [ ] Session validator: `GET /api/v1/auths/` returns expected user shape `[NET]`.
- Accept: smoke prints trio + ≥5 cookies; captured real-client header log committed as fixture evidence; `/api/v1/auths/` parsed on a logged-in manual session; TTL unit test green.

**Phase 2 — Upstream client (Agent A)**
- [ ] `upstream-constants.ts`: all headers/endpoints in one place; `version` set **only from the Phase 1 capture** (omit if not captured); retry budget caps from §4.9 live here.
- [ ] `QwenClient.createChat()` / `.chatCompletion()` with the §4 researched schemas; retry ladder (fresh baxia → legacy body shape → browser transport → next account) **bounded by the request-level retry budget**.
- [ ] SSE parser: line-buffered, partial-safe; handles `response.created`, phase routing (`thinking_summary`/`answer`/**skip-unknown-with-log**), array-valued `summary_thought.content` + separate `summary_title`, cumulative usage, `finished`; tool events preserve name/status/functionId/arguments.
- [ ] Error taxonomy + risk-control detection.
- [ ] `scripts/probe-protocol.ts` (§5) incl. guest-mode viability, stop-body discovery, and **live `t2i` round-trip**.
- [ ] Record live raw SSE into `tests/fixtures/` (one reasoning-heavy, one plain, one with a tool phase if encountered).
- Accept: probe streams a real answer in account mode within the retry budget; parser tests pass offline against fixtures incl. unknown-phase tolerance; guest verdict + t2i verdict recorded in coordination log.

**Phase 3 — Accounts & uploads (Agent A)**
- [ ] SQLite account store: label, profile dir, status(`active|cooldown|needs_login`), cooldown-until, inflight.
- [ ] `scripts/add-account.ts <label>`: headed humanized login-once flow; harvest fat jar; periodic health via `/api/v1/auths/` + `users/status`.
- [ ] AccountPool: least-load, max-inflight, backoff on 429/risk, cross-account retry (rotation count bounded by the same per-request budget).
- [ ] UploadService (STS → OSS PUT V4 → poll → doc parse) — **built here, consumed only from P2-B**.
- Accept: two-account rotation demonstrated; health loop flips an expired session to `needs_login`.

**Phase 4 — API surface (Agent B, starts right after Phase 0; mocks A meanwhile)**
- [ ] Routes `/v1/chat/completions`, `/v1/models`, `/v1/images/generations`, `/healthz`; CORS; bearer-key auth.
- [ ] OpenAI validation: messages/roles, text-only content enforcement for v1 (clear 400 pointing at P2-B for image inputs), `stream`, `reasoning_effort`, image params; model-ID policy per §5.3 (`model_not_found` unless `ALLOW_UNKNOWN_MODELS=true`).
- [ ] SSE writer: `chat.completion.chunk` framing, `reasoning_content` deltas from reasoning events (**title+text mapping decided here**, protocol layer stays neutral), usage chunk before `[DONE]`, heartbeats, disconnect propagation into `AbortSignal`.
- [ ] Non-stream aggregator: consume `NormalEvent[]` → single `chat.completion` with final usage (documented as local aggregation; upstream is SSE-only).
- [ ] Config/logging with redacted cookies; `/healthz` includes registry drift + pool status.
- Accept: full suite green against mock `QwenClient` replaying fixtures — B never waits idle for A.

**Phase 5 — Integration (both)**
- [ ] Wire B→A behind `QWEN_TRANSPORT=mock|live`.
- [ ] E2E matrix: account(+guest if probe passed) × stream/non-stream × reasoning-forced × image (**only if t2i probe passed**) × disconnect-mid-stream (assert best-effort stop fired or upstream socket closed) × retry-budget exhaustion (synthetic failure source; assert ≤4 upstream attempts total).
- [ ] Load sanity: 10 concurrent streams, no interleaved chunks; cooldowns engage; usage totals sane under concurrency; no retry storms under sustained failure injection.
- Accept: any OpenAI SDK streams correctly; README quickstart verified verbatim by the *other* agent.

**Phase 6 — Hardening & docs (both, split by ownership)**
- [ ] Watchdog (restart wedged sessions), TTFT metric, drift alerts surfaced in logs, README (install, accounts, reasoning/usage semantics, guest-mode caveat), troubleshooting (WAF/captcha/binary download on Windows).

---

## 8. Shared contracts (Phase 0 deliverable — `src/types/contracts.ts`)

```ts
// ── Input ──
export type ChatRole = 'system' | 'user' | 'assistant';
export interface IncomingMessage { role: ChatRole; content: string | Array<
  { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> } // image_url rejected at API edge until P2-B

export interface ChatRequest {
  messages: IncomingMessage[];
  model: string;
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high'; // → feature_config.thinking_mode / auto_thinking
  signal?: AbortSignal;
}

// ── Models (replaces bare-string lists) ──
export interface ModelCapabilities {
  vision: boolean; documents: boolean; videoInput: boolean; audioInput: boolean;
  reasoning: boolean; thinkSkip: boolean; webSearch: boolean;
  imageGeneration: boolean; tools: boolean; mcp: boolean;
}
export interface ModelInfo {
  id: string;                    // upstream id, e.g. 'qwen3.7-plus'
  displayName: string;           // 'Qwen3.7-Plus'
  contextWindow: number;         // meta.max_context_length            [NET]
  maxOutputTokens: number;       // max_summary_generation_length | max_generation_length [NET]
  maxThinkingTokens?: number;    // max_thinking_generation_length when declared [NET]
  capabilities: ModelCapabilities;
  chatTypes: string[];           // ['t2t','t2i','search',…] from catalog
  source: 'live' | 'snapshot';
  confidence: 'confirmed' | 'frontend-only' | 'inferred';
}

// ── Normalized upstream events (replaces NormalDelta) ──
export interface UsageInfo {
  inputTokens: number; outputTokens: number; totalTokens: number;
  outputTextTokens?: number; reasoningTokens?: number; cachedTokens?: number;
}
export interface GatewayError { message: string; code?: string;
  kind: 'rate_limit' | 'waf' | 'captcha' | 'upstream' | 'auth' | 'network' }

export type NormalEvent =
  | { type: 'created';   chatId: string; responseId?: string }
  | { type: 'reasoning'; text: string; title?: string }              // summary_thought + summary_title kept SEPARATE;
                                                                     // OpenAI adapter decides presentation
  | { type: 'content';   text: string }                              // phase === 'answer'
  | { type: 'tool';      name: string; status: string; functionId?: string;
        arguments?: unknown }                                        // native tool phases preserved verbatim
                                                                     // (name/status/functionId/arguments); v1 logs only
  | { type: 'usage';     usage: UsageInfo }                          // cumulative — last one before finished wins
  | { type: 'finished';  finishReason: 'stop' | 'length' | 'aborted' }
  | { type: 'error';     error: GatewayError };

export interface CompletionResult {
  content: string; reasoning: string;
  usage?: UsageInfo;                       // real upstream counts [RUN]
  finishReason: 'stop' | 'length' | 'aborted' | 'error';
}

// ── Client & pool ──
// QwenClient is a thin façade. Internally it composes distinct concerns, each its own module:
//   QwenProtocol  — payload builders + SSE parsing + error classification (pure, unit-testable)
//   TransportRouter — http-first / browser-fallback decisioning per attempt
//   RetryPolicy   — the §4.9 request-level budget (attempts/rotations/fallbacks/duration)
//   SessionService, TokenService, ModelRegistry, AccountPool — as elsewhere in this plan
export type Transport = 'http' | 'browser';

export interface QwenClient {
  chatStream(req: ChatRequest, onEvent: (e: NormalEvent) => void): Promise<CompletionResult>;
  generateImages(req: { prompt: string; n?: number; size?: string;
    responseFormat?: 'url' | 'b64_json' }): Promise<{ urls: string[]; b64?: string[] }>;
  listModels(): Promise<ModelInfo[]>;      // full metadata — callers map to OpenAI format
  refreshRegistry(): Promise<void>;        // live /api/v2/models/ sync + drift diff
}

export interface Lease { release(): void }
export interface AccountPool {
  acquire(): Promise<Lease>;
  status(): Array<{ label: string; status: string; cooldownUntil?: number; inflight: number }>;
}
```

Both agents code strictly against these interfaces. Any change ⇒ note in `COORDINATION.md` + version comment bump (Phase 0–1 evidence exception per ground rule 1). `NormalDelta` from plan v1 is retired; migration is free since neither side had implemented yet.

**Cross-check note (audit):** the §6 v1 wording "summary title folded into text" describes only the OpenAI adapter's presentation choice; the contract above and §4 keep title/text separate end-to-end. `reasoningEffort` uses contract values (`none|low|medium|high`); the OpenAI alias `minimal` maps to `none` at the API edge (§6).

---

## 9. Two-agent ownership & parallelization

**Sync points (blocking):** Phase 0 contract commit; Phase 5 wiring day. Everything else parallel.

| Area | Files | Owner |
|---|---|---|
| CloakBrowser wrappers, harvesters, login scripts, session validator | `src/browser/**`, `scripts/smoke-browser.ts`, `scripts/add-account.ts` | **A** |
| Baxia/token cache, protocol layer, transport router, retry policy, QwenClient façade, uploads, pool, upstream constants | `src/services/` (`protocol/`, `transport/`, `retry.ts`, `qwen-client.ts`, `token/`, `session/`, `upload.ts`, `account-pool.ts`) | **A** |
| ModelRegistry + snapshot + probe script | `src/services/model-registry.ts`, `config/qwen-models.snapshot.json`, `scripts/probe-protocol.ts` | **A** |
| Fixtures + unit tests for the above | `tests/unit/**`, `tests/fixtures/**` | **A** |
| HTTP server, routes, OpenAI validation, SSE writer/aggregator, auth, config, logging | `src/server/**`, `src/index.ts` | **B** |
| Mock QwenClient + API e2e tests | `tests/api/**`, `tests/mocks/**` | **B** |
| README, .env.example, Dockerfile (later) | root docs | **B** |
| `src/types/**`, `package.json`, `tsconfig.json` | shared | **A creates in P0; changes require COORDINATION note** |

**Cadence:** after each task, append `## <date> — Agent X` to `COORDINATION.md` (done / deviations / blockers / next). If blocked >1 phase-step on the other's piece, build the mock per Phase 4 instead of waiting.

---

## 10. Risks & mitigations (v2)

| Risk | Mitigation |
|---|---|
| Guest mode may no longer work (`chat_mode:'guest'` untested by research; account mode is the verified path) | Probe in Phase 2 gates it; `GUEST_MODE=false` default; account mode is the supported path; docs state the caveat |
| `version` header value unknown (refs `0.2.83`; research reports app `0.4.4` / bundle `0.2.87` but **no captured outbound header**) | Phase 1 captures the real client's header set via request interception; omit the header until then; constants carry `[NET]` provenance; probe re-validates |
| `chats/new` schema drift (`chatId` gained, `title` lost) | Researched shape first, legacy shape as retry rung |
| Baxia extraction brittle | Request-interception-first harvesting; aggressive caching; wu.json + synthetic fallback chain |
| WAF/captcha despite fat cookies | Browser-transport fallback mandatory (§2.4); qwengate HANDOFF proves thin sessions fail |
| Stream contamination by tools/search (native tool phases, auto_search) in v1 text chat | Force `auto_search:false` and disable account-level tools/memory at configure time (qwengate settings payload); parser routes unknown phases to `tool` events and never crashes |
| Image-generation backend ambiguity (`t2i` catalog-confirmed vs `[FE]`-only `qwen-image-*` models; URL extraction unverified at runtime) | `t2i` path ships **probe-gated** (§6); clean 501 if probe fails; image-model switch behind config |
| Model-catalog drift (new IDs, changed caps, omni key-naming inconsistency `max_generation_length` vs `max_summary_generation_length`) | ModelRegistry live-sync + drift log; unknown IDs → clean `model_not_found` unless `ALLOW_UNKNOWN_MODELS=true` (§5.3) |
| Retry storms under sustained upstream failure | Per-request budget §4.9 (≤4 attempts, ≤2 rotations, ≤1 browser fallback, ≤60s); e2e failure-injection asserts caps hold |
| CloakBrowser binary download fails on Windows | Phase 1 smoke catches early; manual download + `CLOAKBROWSER_BINARY_PATH` documented |
| Rate limits / account bans | Rotation + cooldowns + backoff; recommend 3+ throwaway accounts; guest fallback only if probe passes |
| Agents colliding on files | Ownership table; shared types frozen except per ground rules 1/3 (evidence-driven, coordination-noted) |

---

## 11. Contradiction ledger (open items resolved by probe, not by debate)

1. **Guest mode** — refs: worked (`chat_mode:'guest'`); research: silent on it. → Phase 2 probe decides; account mode primary regardless.
2. **`version` request header** — refs send `0.2.83`; research reports app `0.4.4` / bundle `0.2.87`, but **captured no outbound request header**, so no mapping is established. → Do not guess: omit the header until Phase 1 captures the real client's value; then pin with `[NET]` provenance and re-validate via probe (§4).
3. **`chats/new` body** — researched shape (`chatId`, no `title`) tried first; legacy shape kept as retry fallback.
4. **Image backend & extraction** — `t2i` on flagship models is catalog-confirmed `[NET]`, but image-URL extraction from the SSE stream is only old-ref behavior; `qwen-image-3.0/2.0-pro` are `[FE]`. → Live `t2i` probe decides both backend and extraction; `/v1/images/generations` ships 501 if it fails (§6).
5. **Omni tool support** — matrix says "Limited", registry JSON says `false`. → Registry JSON (`false`) wins for machine data; irrelevant to v1 either way.
6. **Max input ceilings** — `[INF]` only; no hard enforcement in v1, advisory warnings only.

---

## 12. Definition of done (v1)

1. Fresh clone + `npm i` + `.env` → `npm start` serves `/v1/*` on `:8080` (configurable).
2. Streaming chat: OpenAI-shaped `chat.completion.chunk`s including `reasoning_content` deltas when the model reasons, a final chunk carrying **real upstream usage** (`prompt_tokens`/`completion_tokens`/`total_tokens` + reasoning breakdown), terminated by `[DONE]`.
3. Same call with `stream:false` returns an aggregated `chat.completion` with identical content and usage.
4. `GET /v1/models` reflects the live upstream catalog (or labeled snapshot when upstream unreachable), with per-model context/output limits available internally and drift flagged in `/healthz`. A request for a model absent from the registry returns OpenAI-style 404 unless `ALLOW_UNKNOWN_MODELS=true` (§5.3).
5. Image generation returns ≥1 usable URL via the `t2i` path **(applies only if the Phase 2 live `t2i` probe passed; otherwise the endpoint responds 501 and DoD item 3/5 are satisfied with text-chat criteria alone — recorded in coordination log)**.
6. At least one logged-in account rotates healthy across 20 sequential requests; session health checked via `/api/v1/auths/`; guest mode either passes its probe or is documented-off.
7. Killing a client mid-stream aborts the upstream work (best-effort `stop` call or socket close, verified in e2e).
8. Parser fixture suite green, including unknown-tool-phase tolerance (tool events preserve name/status/functionId/arguments) and array-form reasoning payloads with separate title/text.
9. Under injected upstream failure, a single request makes at most 4 attempts / 2 account rotations / 1 browser fallback within a 60s budget (§4.9), verified in e2e.
10. `npx vitest run` green; README quickstart tested end-to-end by the agent that didn't write it.
