# COORDINATION.md

> Append one `## <date> — <Actor>` block per completed task: done / deviations / blockers / next.
> Shared-contract changes require a note here before merging.
>
> **Execution Model Note:** As confirmed by the operator, this project is executed by a **sole implementation agent** combining all responsibilities formerly divided between Agent A (Core) and Agent B (Surface).

---

## 2026-08-25 — Orchestrator (plan revision, pre-agent)

**Done:** plan.md revised v1 → v2 incorporating `Research.md` (live discovery 2026-08-25, app `0.4.4`, bundle `0.2.87`).

**What was incorporated:**
- Protocol baseline switched from reference repos to `Research.md`; references demoted to fallback/ops knowledge. Research wins all conflicts.
- Model registry replaced: old default `qwen3-max`-era assumptions → researched catalog of 6 models (`qwen3.7-plus` default) with `[NET]` context/output/thinking limits and capability flags; new `ModelInfo`/`ModelCapabilities` contract.
- Endpoint corrections: `/api/models` → `GET /api/v2/models/`; `getstsToken` GET → POST; added `/api/v2/chats/{id}`, `/api/v1/auths/`, `/api/v2/users/status`, stop endpoint.
- Request schema updated to researched shape (`chat_mode:'normal'`, `chatId`+`parent_id` dual spellings, message-level `model`, `contentType:'text'`, `status:'completed'`, thinking modes Auto/Thinking/Fast); legacy guest shape kept only as probe-gated fallback + retry rung.
- SSE protocol rewritten: `response.created` first event, phase routing (`thinking_summary` array payloads / `answer` / skip-unknown tool phases), cumulative in-stream `usage`, `finished` status.
- Non-streaming redefined as local aggregation (upstream is SSE-only for all models); usage now real upstream counts instead of estimates.
- New §5 capability registry: snapshot JSON seeded from Research.md §16, live sync via models endpoint, drift detection/logging, probe script (`scripts/probe-protocol.ts`) for version/schema/guest/t2i verification.
- Evidence tagging system (`[NET]/[RUN]/[FE]/[INF]`) mandated for all implemented protocol facts; confirmed-vs-frontend-only split made explicit (§4 end).
- Contracts redesigned: `NormalDelta` retired → `NormalEvent[]`; `UsageInfo`, `CompletionResult`, `ChatRequest.reasoningEffort`, `listModels() → ModelInfo[]`, `refreshRegistry()` added.
- v1 scope unchanged (text chat, stream/non-stream, reasoning, usage, models, auth/sessions, images); search/files/vision/tools/MCP/TTS/audio-video/artifacts explicitly parked in named later phases.
- Added contradiction ledger (§11) for unresolved refs-vs-research items; acceptance criteria (§12) and risks (§10) updated accordingly.

**Next:** Phase 0 bootstrap per plan.md §7. Both agents read plan.md v2 + Research.md before coding.

---

## 2026-08-25 — Orchestrator (audit pass, plan v2 → v2.1)

Point audit of plan.md against Research.md; no scope changes, no wholesale rewrite. Changes:

1. **`version` request header downgraded to UNKNOWN (§4, §10, §11.2):** removed the assumption that bundle `0.2.87` is the API header value. New policy — capture the real client's outbound header set via Phase 1 request interception; omit the header until captured; pin with `[NET]` provenance afterwards.
2. **HTTP/2 softened (§3, §4, §4-end):** HTTPS is the requirement; HTTP/2 is an observed runtime property to be logged, never a hardcoded guarantee.
3. **Tool events enriched (§4.3, contracts):** normalized `tool` event now carries `functionId`, name, arguments payload, status verbatim (native execution still out of v1).
4. **Reasoning title/text kept separate through the protocol layer (§4.3, contracts, §6):** OpenAI adapter decides presentation; fixed a leftover "title folded into text" phrase that contradicted this.
5. **QwenClient decomposed into concerns (§3 diagram, §8 comment, §9 ownership):** QwenProtocol / TransportRouter / RetryPolicy / Session / Token / Registry / Pool; QwenClient is a thin façade.
6. **Request-level retry budget added (§4.9):** ≤4 attempts, ≤2 account rotations, ≤1 browser fallback, ≤60s wall clock, jittered backoff, captcha/auth short-circuit; wired into chats/new retry wording, phases 2/3/5 acceptance, DoD #9, risk table.
7. **Model registry policy corrected (§5.3, Phase 4, DoD #4):** live-discovered models register dynamically; user-requested unknown IDs → clean `model_not_found` unless new `ALLOW_UNKNOWN_MODELS=false` env (added to Phase 0 `.env.example` and §5.6). Replaced earlier "never fail on unknown ID" wording.
8. **Image generation probe-gated (§6, §11.4, DoD #5):** ships only if the live `t2i` round-trip probe passes (URL extraction unverified); clean 501 otherwise.
9. **Ground rule 1 relaxed for Phase 0–1 contract refinement** on `[NET]`/`[RUN]` evidence with coordination notes (ground rule 3 aligned).
10. Consistency sweep: reasoning_effort contract values vs OpenAI `minimal` alias reconciled; repo layout updated for layered services; ledger item 4 expanded (extraction verification); cross-check note appended after contracts.

No unresolved contradictions remain between plan.md, Research.md, the ledger, contracts, acceptance criteria, and DoD; open items are all explicitly probe-gated in §11.

---

## 2026-08-26 — Sole Implementation Agent (Gate 0 / Phase 0 Reconciliation)

**Done:** Read all 4 GitHub markdown files (`plan.md` v2.1, `Research.md`, `Research V2.md`, and upstream `COORDINATION.md`). Aligned entire repository state with the single-agent mandate:
1. Single-agent ownership established across Upstream Core and API Surface.
2. Contracts committed to `src/types/contracts.ts` verbatim from `plan.md §8`.
3. Sibling wire types committed in `src/types/openai.ts` and `src/types/qwen.ts`.
4. `config/qwen-models.snapshot.json` seeded from `Research.md §16` with 6 models.
5. `tsconfig.json` tuned for strict ESM with `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true`.
6. Gate 0 tests passing (9/9 unit tests).

---

## 2026-08-26 — Sole Implementation Agent (Phase 1–4 Core & Surface Implementation)

**Done:** Following operator instruction to continue, implemented and verified the layered service architecture, CloakBrowser integration modules, and OpenAI-compatible API surface:

1. **Protocol & Constants (`src/services/`):**
   - `upstream-constants.ts`: Base URLs, endpoints, Chrome User-Agent, omission of uncaptured `version` header per §4/§11.2, and retry budget constants.
   - `protocol/payload-builder.ts`: Generates researched `ChatsNewBody` and `ChatCompletionsBody` with dual `chatId`/`chat_id` and `parentId`/`parent_id`, `version: "2.1"`, message `fid` UUIDs, and `thinking_mode` mapping.
   - `protocol/sse-parser.ts`: Line-buffered, fragmentation-tolerant SSE parser handling `response.created`, multi-phase routing (`thinking_summary` with array-valued thoughts/titles, `answer`, and safe pass-through of unknown `tool` phases), cumulative in-stream `usage`, and finish events.
   - `protocol/error-classifier.ts`: Classifies status codes, WAF HTML blocks, Baxia `FAIL_SYS_USER_VALIDATE` / `rgv587` CAPTCHAs, and auth expirations into typed `GatewayError`s.
2. **Retry Policy (`src/services/retry.ts`):**
   - Implements `RequestRetryBudget` strictly enforcing §4.9 caps: max 4 attempts, max 2 account rotations, max 1 browser fallback, max 60s total duration, with exponential backoff and jitter.
3. **Model Registry & Drift Detection (`src/services/model-registry.ts`):**
   - Loads baseline from `config/qwen-models.snapshot.json`.
   - Supports live sync via `GET /api/v2/models/` with drift recording to `data/drift.log`.
   - Converts catalog to OpenAI `/v1/models` format.
   - Rejects unknown model requests with 404 `model_not_found` unless `ALLOW_UNKNOWN_MODELS=true`.
4. **Session & Token Services (`src/services/session/`, `src/services/token/`):**
   - `session-service.ts`: Manages persistent fat cookie jars (`cna`, `ssxmod_itna`, `tfstk`, `isg`, `x5sec`, `token`) in `data/profiles/<id>/cookies.json` and session health checks via `GET /api/v1/auths/`.
   - `token-service.ts`: Caches harvested Baxia trio (`bx-ua`, `bx-umidtoken`, `bx-v`) with TTL and provides synthetic fallback tokens.
5. **Account Pool (`src/services/account-pool.ts`):**
   - Implements `AccountPool` and `Lease` contracts with SQLite persistence (`better-sqlite3`), tracking active/cooldown accounts and least-inflight rotation.
6. **CloakBrowser & Transport (`src/browser/`, `src/services/transport/`):**
   - `launch.ts`: Singleton manager supporting headless toggles, binary path overrides (`CLOAKBROWSER_BINARY_PATH`), and persistent profiles via `launchPersistentContext`.
   - `harvester.ts`: Intercepts page requests to capture outbound headers and Baxia trio; harvests complete cookie jars.
   - `fallback-fetch.ts`: Evaluates `fetch()` inside page context when direct HTTP encounters WAF.
   - `transport-router.ts`: Manages HTTP-first stream execution, browser fallback, and mock transport mode.
   - `qwen-client.ts`: Canonical `QwenClient` façade composing protocol, transport, retry budget, registry, session, and pool.
7. **API Surface & Streaming (`src/server/`):**
   - `app.ts`: Hono application implementing `/v1/chat/completions`, `/v1/models`, `/v1/images/generations`, and `/healthz`.
   - Enforces v1 text-only constraints (rejects `image_url` with 400 pointing at future P2-B phase).
   - `sse-writer.ts`: Formats OpenAI `chat.completion.chunk` events, streaming `reasoning_content` and emitting the usage chunk before `[DONE]`.
   - Local stream aggregation for non-streaming completions (`stream: false`).
   - `auth-middleware.ts`: Bearer API key protection when `API_KEYS` is configured.
8. **Scripts (`scripts/`):**
   - `check-cloakbrowser.ts`: Safe diagnostic environment inspection.
   - `probe-protocol.ts`: Protocol validation script per §5.4.
   - `smoke-browser.ts`: Browser launch and cookie dump smoke test.
   - `add-account.ts`: Persistent profile login and registration helper.
9. **Testing & Build Verification:**
   - Vitest suite expanded: 26 passed tests across 4 files (`contracts.test.ts`, `snapshot.test.ts`, `protocol.test.ts`, `routes.test.ts`).
   - `npx tsc --noEmit` and `npm run build` pass cleanly with zero errors.
   - Real HTTP/SSE loop tested against local dev server verifying non-stream and stream completion responses.
