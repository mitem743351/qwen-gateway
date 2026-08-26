# Project Qwen — Implementation & Verification Audit (`AUDIT.md`)

*Date: 2026-08-26*  
*Auditor: Sole Implementation Agent*  
*Repository: `mitem743351/qwen-gateway`*  
*Branch: `arena/01a03d87-qwen-gateway`*  
*Evidence Taxonomy: `[RUN-LOCAL]`, `[RUN-MOCK]`, `[NET]`, `[RUN-QWEN]`, `[REF]`, `[FE]`, `[INF]`*

---

## 1. Audit Overview & Methodology

Following Gate 0 completion, substantial portions of the gateway architecture were implemented. This document establishes an objective, factual audit of every subsystem:
1. Distinguishing genuine runtime verification from local mock and fixture execution.
2. Characterizing the status of the CloakBrowser runtime, persistent profiles, and external connectivity.
3. Auditing the Git exposure and schema of the test credential file `cookies.json`.
4. Providing an evidence-tagged verification matrix.

---

## 2. Git Exposure Audit for `cookies.json`

| Metric | Status | Finding / Evidence |
|---|---|---|
| **File Location** | `/home/user/qwen-gateway/cookies.json` | Present in workspace root |
| **Tracked in Git** | **YES** | Tracked on upstream remote `origin/main` in commit `04f5350d7c3732dd05c4f67eaa78655da7cf0a54` (`Add files via upload`) |
| **Ignored in Working Tree** | **YES** | Added to `.gitignore` on branch `arena/01a03d87-qwen-gateway`; `git check-ignore -v cookies.json` returns `.gitignore:7:cookies.json` |
| **Exposure Risk** | **HIGH** | The file contains valid session tokens (`token`, `cna`, `isg`, `tfstk`, `ssxmod_itna`) that were pushed to the public Git remote `origin/main`. |

*Note:* In our working branch `arena/01a03d87-qwen-gateway`, `cookies.json` has been uncommitted and ignored to prevent further leakage.

---

## 3. Subsystem Implementation & Verification Audit

| Subsystem | Implemented? | Tested? | Verification type | Real Qwen verified? | Evidence | Confidence |
|---|---|---|---|---|---|---|
| **CloakBrowser launch** | Yes (`src/browser/launch.ts`) | Yes | Diagnostics & error handling | No (`BLOCKED`) | `[RUN-LOCAL]` | High (Code) / Blocked (Runtime) |
| **Persistent profile** | Yes (`src/browser/profile.ts`) | Yes | Pure unit tests + local test script | No (`BLOCKED`) | `[RUN-LOCAL]` | High (Code) / Blocked (Runtime) |
| **Cookie import** | Yes (`scripts/import-test-cookies.ts`) | Yes | Schema parsing & Playwright mapping | No (`BLOCKED`) | `[RUN-LOCAL]` | High (Code) / Blocked (Runtime) |
| **Request interception** | Yes (`scripts/test-request-interception.ts`, `src/browser/harvester.ts`) | Yes | Local HTTP test script & unit tests | No (`BLOCKED`) | `[RUN-LOCAL]` | High (Code) / Blocked (Runtime) |
| **Qwen connectivity** | Yes (`scripts/test-qwen-connectivity.ts`) | Yes | Multi-layer network probe | DNS/TCP Yes, TLS/HTTP No | `[NET]` | High (Egress Block Confirmed) |
| **Supplied session validity** | Script ready (`src/services/session/session-service.ts`) | No | Network dropped at TLS handshake | No (`BLOCKED`) | `[NET]` | Blocked (Firewall Egress) |
| **Authentication** | Yes (`src/services/session/session-service.ts`) | No | `/api/v1/auths/` code path ready | No (`BLOCKED`) | `[FE]` / `[REF]` | Medium (Unverified Live) |
| **Baxia harvesting** | Yes (`src/browser/harvester.ts`, `src/services/token/token-service.ts`) | Partial | Interception hooks + synthetic fallback | No (`BLOCKED`) | `[RUN-MOCK]` / `[INF]` | Low (Synthetic only) |
| **Chat creation** | Yes (`src/services/protocol/payload-builder.ts`) | Yes | Unit tests against researched schema | No (`BLOCKED`) | `[RUN-LOCAL]` / `[FE]` | High (Schema matches Research.md) |
| **Chat completion** | Yes (`src/services/protocol/payload-builder.ts`) | Yes | Unit tests against dual-key schema | No (`BLOCKED`) | `[RUN-LOCAL]` / `[FE]` | High (Schema matches Research.md) |
| **SSE parser** | Yes (`src/services/protocol/sse-parser.ts`) | Yes | Line-buffered fixture tests with phase routing | No (`BLOCKED`) | `[RUN-MOCK]` | High (Parser robust to spec) |
| **Usage parsing** | Yes (`src/services/protocol/sse-parser.ts`) | Yes | In-stream cumulative usage tests | No (`BLOCKED`) | `[RUN-MOCK]` | High (Matches Research.md §6) |
| **Retry logic** | Yes (`src/services/retry.ts`) | Yes | Hard cap tests (4 attempts, 2 rotations, 1 fallback, 60s) | No | `[RUN-LOCAL]` | High (Enforced by unit test) |
| **Model registry** | Yes (`src/services/model-registry.ts`) | Yes | 6-model snapshot test + OpenAI list | No (`BLOCKED`) | `[RUN-LOCAL]` / `[FE]` | High (Seeded from Research.md §16) |
| **Account pool** | Yes (`src/services/account-pool.ts`) | Yes | SQLite lease acquisition & inflight counter | No | `[RUN-LOCAL]` | High (Native SQLite verified) |
| **HTTP transport** | Yes (`src/services/transport/transport-router.ts`) | Yes | Mock transport verified; HTTP blocked by firewall | No (`BLOCKED`) | `[RUN-MOCK]` | High (Mock) / Blocked (Live) |
| **Browser fallback** | Yes (`src/browser/fallback-fetch.ts`) | No | Code path exists; requires active browser page | No (`BLOCKED`) | `[REF]` | Low (Untested Runtime) |
| **`/v1/chat/completions`** | Yes (`src/server/app.ts`) | Yes | Streaming SSE & non-streaming mock tests | No | `[RUN-MOCK]` | High (OpenAI API compatibility) |
| **`/v1/models`** | Yes (`src/server/app.ts`) | Yes | Integration test returning 6 models | No | `[RUN-LOCAL]` | High (OpenAI API compatibility) |
| **Image generation** | Probe-gated (`src/server/app.ts`) | Yes | Returns 501 in live mode; mock in test | No | `[RUN-MOCK]` | High (Gate holds as designed) |

---

## 4. Audit of Mock versus Live Artifacts

The following components were verified strictly using mock/synthetic execution (`[RUN-MOCK]`) and do **not** constitute live verification against `chat.qwen.ai`:

1. **`executeMockStream()` in `src/services/transport/transport-router.ts` (`[RUN-MOCK]`):**
   - Emits synthetic `created`, `reasoning` ("Examining the question..."), chunked text, and cumulative `usage`.
   - Used by `tests/api/routes.test.ts`. Proves Hono route handling and SSE chunk formatting, but does **not** prove upstream Qwen connectivity or protocol compliance.
2. **`getSyntheticTokens()` in `src/services/token/token-service.ts` (`[INF]` / `[RUN-MOCK]`):**
   - Synthesizes `bx-ua: 2.0.0-...`, `bx-umidtoken: c-...`, and `bx-v: 2.5.0`.
   - Inferred from reference implementations. Has **not** been accepted or validated by Aliyun Baxia risk controls on live endpoints.
3. **Static SSE Fixtures in `tests/unit/protocol.test.ts` (`[RUN-MOCK]`):**
   - Verifies that `QwenSseParser` parses `response.created`, array-valued `summary_thought`, and `usage`. Proves parser logic, but does **not** prove that Qwen currently emits this exact stream.
4. **Mock Image Generator in `src/services/qwen-client.ts` (`[RUN-MOCK]`):**
   - Returns placeholder URLs when in mock mode. In live mode, HTTP 501 is returned because the `t2i` probe is blocked.

---

## 5. Session Architecture Audit

The repository enforces the following separation of concerns:
- **Authoritative Session State:** The persistent CloakBrowser user data directory (`data/profiles/<accountId>/`).
- **Cached Session Metadata:** `data/profiles/<accountId>/cookies.json` generated by browser harvesting.
- **Supplied Test Input:** Root `cookies.json` is treated strictly as an **external test credential import**, never as authoritative system state.

---

## 6. Verification Matrix

| Domain | Status | Rating | Reason / Evidence |
|---|---|---|---|
| **Browser Runtime** | `BLOCKED` | **BLOCKED** | Chromium binary 146.0.7680.177.5 absent from disk; downloads blocked by egress filter (`[RUN]`). |
| **Persistent Profile** | `BLOCKED` | **BLOCKED** | Profile directory logic works `[RUN-LOCAL]`, but browser context launch is blocked by missing binary. |
| **Supplied Cookies** | `DEMONSTRATED` | **GREEN** | 15 cookies parsed and mapped to Playwright format; all secrets redacted in logs (`[RUN-LOCAL]`). |
| **Authentication** | `BLOCKED` | **BLOCKED** | Session validation against `GET /api/v1/auths/` blocked by sandbox egress firewall (`[NET]`). |
| **Qwen Connectivity** | `BLOCKED` | **BLOCKED** | DNS/TCP succeed; TLS handshake dropped by sandbox egress firewall (`[NET]`). |
| **Request Capture** | `BLOCKED` | **BLOCKED** | Requires active browser navigating to `chat.qwen.ai` (`[BLOCKED]`). |
| **Version Header** | `UNRESOLVED` | **YELLOW** | Value unconfirmed by live capture; omitted from outbound requests per protocol policy (`[FE]`). |
| **Baxia Harvesting** | `SYNTHETIC ONLY` | **YELLOW** | Interception logic ready, but live harvesting blocked; synthetic fallback is experimental (`[INF]`). |
| **HTTP Replay** | `UNJUSTIFIED` | **RED** | Cannot be justified or verified until a real authenticated request is captured live. |
| **SSE Parser** | `VERIFIED` | **GREEN** | Robust line-buffered parser handles multi-phase streams and tools offline (`[RUN-MOCK]`). |
| **API Gateway Surface**| `VERIFIED` | **GREEN** | Hono routes (`/v1/chat/completions`, `/v1/models`, `/healthz`) 100% passing (`[RUN-MOCK]`). |
