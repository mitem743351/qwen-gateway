# COORDINATION.md

> Append one `## <date> — Agent X` block per completed task: done / deviations / blockers / next.
> Shared-contract changes require a note here before merging.

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

## 2026-08-25 — Agent A (Phase 0 complete)

**Done:** Bootstrap skeleton committed; `npm install && npx tsc --noEmit && npx vitest run` green (7 tests pass).

- `package.json` (type: module; deps: cloakbrowser@^0.5.8, hono, better-sqlite3, zod; dev: tsx, typescript, vitest), `tsconfig.json` (NodeNext/ESM, strict + `exactOptionalPropertyTypes` + `noUncheckedIndexedAccess`), `vitest.config.ts`, `.env.example` (all §7 keys incl. `ALLOW_UNKNOWN_MODELS`, `QWEN_TRANSPORT=mock|live` for Phase 5, retry-budget overrides), `.gitignore` (`data/`, `.env`, `dist/` ignored per ground rule 5).
- `src/types/contracts.ts` committed **verbatim** from plan §8. Added two sibling files B should code against: `src/types/openai.ts` (OpenAI wire shapes: chunk/completion/usage-details/error body) and `src/types/qwen.ts` (upstream wire shapes from Research §5–§7: `ChatsNewBody`, `ChatCompletionsBody` incl. dual `chatId`/`chat_id` spellings, `ResponseCreated`, `StreamDelta` with array-valued `summary_title`/`summary_thought`, cumulative `WireUsage`, `WireModel`). No changes to plan §8 contract text itself.
- `config/qwen-models.snapshot.json` seeded verbatim from Research §16 (6 models); added `max_thinking_tokens: 81920` to `qwen3.7-max` (from `max_thinking_generation_length`, [NET]) and provenance header fields (`generated_at`, `source`).
- Tests: `tests/unit/snapshot.test.ts` (pins the 6 IDs + limits vs Research §16) and `tests/unit/contracts.test.ts` (contract-shape smoke).

**Deviations:** none of substance. Two environment notes: (1) D: drive was full → repo-level `.npmrc` points npm cache at `G:\Project Qwen\.npm-cache` so installs work on this machine; (2) npm's install-scripts allowlist blocked `better-sqlite3`'s build script — approved via `npm install-scripts approve better-sqlite3` and verified loadable in Node.

**Notes for Agent B:** `exactOptionalPropertyTypes` is on — optional props must not be assigned `undefined` explicitly. `QWEN_TRANSPORT` env exists for your Phase 4 mock/live wiring. OpenAI usage mapping: upstream `input_tokens→prompt_tokens`, `output_tokens→completion_tokens`, `output_tokens_details.reasoning_tokens→completion_tokens_details.reasoning_tokens`, `prompt_tokens_details.cached_tokens→prompt_tokens_details.cached_tokens`.

**Next (A):** Phase 1 browser foundation — launcher wrapper, persistent profiles, cookie/baxia harvesters, session validator, smoke script.

