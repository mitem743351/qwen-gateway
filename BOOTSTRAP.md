# Project Qwen — Bootstrap & Reconnaissance Report (`BOOTSTRAP.md`)

*Date: 2026-08-26*  
*Agent: Sole Implementation Agent (owns both Upstream Core and API Surface)*  
*Branch: `arena/01a03d87-qwen-gateway`*  
*Specifications: `plan.md` (v2.1), `Research.md`, `Research V2.md`, `COORDINATION.md`*

---

## 1. Environment Status

| Metric / Dimension | Detected State | Verification Command | Notes / Workarounds |
|---|---|---|---|
| **OS / Kernel** | Debian GNU/Linux 12 (bookworm), Linux `6.1.158+` x86_64 | `uname -a`, `/etc/os-release` | Standard Linux sandbox environment |
| **CPU Architecture** | `x86_64` | `uname -m` | 64-bit AMD/Intel architecture |
| **Working Directory** | `/home/user/qwen-gateway` | `pwd` | Project root |
| **Shell** | `/bin/bash` | `echo $SHELL` | Default shell |
| **Node.js Version** | `v22.22.3` | `node -v` | Node `>= 20` requirement satisfied |
| **npm Version** | `10.9.8` | `npm -v` | Functional package manager |
| **Git Version** | `git version 2.39.5` | `git --version` | Clean working tree on `arena/01a03d87-qwen-gateway` |
| **Python Version** | `Python 3.11.2` | `python3 --version` | Used by `node-gyp` for native addon builds |
| **C/C++ Toolchain** | `gcc 12.2.0`, `g++ 12.2.0`, `GNU Make 4.3` | `gcc -v`, `make -v` | Installed and operational |
| **Local Node Headers** | `/usr/local/include/node/node.h` | `find /usr -name node.h` | Enabled offline compilation via `npm_config_nodedir=/usr/local` |
| **System Chromium / Chrome** | Absent | `which chromium google-chrome` | No pre-installed browser in system PATH |
| **Network: npm Registry** | Operational | `npm ping` | `https://registry.npmjs.org` reachable (HTTP 200) |
| **Network: GitHub** | Operational | `git ls-remote`, `gh api` | Repository operations and API reachable |
| **Network: General Web** | Egress filtered | `curl -I https://chat.qwen.ai` | TLS handshake fails with `SSL_ERROR_SYSCALL` (sandbox security) |
| **TLS Certificate Bundle** | Intercepted CA | Node HTTPS test | Requires `NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` |

---

## 2. Repository Status & Specifications

### 2.1 Specification Documents Ingested
The repository received 4 authoritative specification files from `origin/main`:
1. **`plan.md` (v2.1, audit revision 2026-08-25)**: Defines target architecture, evidence discipline (`[NET]`, `[RUN]`, `[FE]`, `[INF]`), layered service decomposition, shared contracts (§8), request-level retry budget (§4.9), contradiction ledger (§11), and definition of done (§12).
2. **`Research.md` (live discovery 2026-08-25)**: Live discovery report on `chat.qwen.ai` (app `0.4.4`, bundle `0.2.87`) using CloakBrowser Chromium v146. Authoritative source on models (§16), token limits, endpoints, multi-phase SSE format, MCP host, and file storage pipeline.
3. **`Research V2.md`**: Extended discovery report detailing multimodal capabilities, STS token acquisition, and tool definitions.
4. **`COORDINATION.md`**: Master development coordination log.

### 2.2 Single-Agent Execution Model
While `plan.md` and `COORDINATION.md` reference a historical division between Agent A (Core) and Agent B (Surface), the user operator has confirmed:
> **"You are only one agent, so COORDINATION and Plan says two agent but you will do both one."**

The sole implementation agent owns the entire codebase end-to-end, executing upstream protocol services, browser automation, data persistence, and OpenAI-compatible API routes without cross-agent handoffs.

---

## 3. Specification Interpretation & Architectural Baseline

### 3.1 Architectural Flow
```text
OpenAI Client (/v1/chat/completions, /v1/models, /v1/images/generations)
       │
       ▼
API Surface (Hono ESM Server)
  - Schema validation (OpenAI format, text-only enforcement for v1)
  - Stream=false local aggregation (upstream is SSE-only)
  - SSE writer (chat.completion.chunk, reasoning_content, usage before [DONE])
  - Gateway API key auth & /healthz
       │ (calls QwenClient façade via src/types/contracts.ts)
       ▼
Upstream Core (Layered Services)
  - QwenProtocol: Payload builders, line-buffered SSE parser, error classifier
  - TransportRouter: HTTP-first execution + CloakBrowser fallback
  - RetryPolicy: Hard request budget (≤4 attempts, ≤2 rotations, ≤1 browser fallback, ≤60s)
  - SessionService: Persistent profile manager, fat cookie jar, /api/v1/auths/ validator
  - TokenService: Baxia trio cache (bx-ua, bx-umidtoken, bx-v)
  - ModelRegistry: Snapshot-seeded (6 models), live sync via GET /api/v2/models/, drift detection
  - AccountPool: Multi-account lease management, cooldowns, least-load routing
       │
       ▼ (HTTPS fetch / CloakBrowser evaluation)
https://chat.qwen.ai
```

### 3.2 Non-Negotiable Protocol Facts (`[NET]`/`[RUN]`)
1. **Upstream is SSE-Only**: `supports_non_streaming: false` across all models. `stream: false` in OpenAI gateway is local stream aggregation.
2. **Usage is Streamed Incrementally**: Real cumulative token counters arrive in every SSE chunk (`input_tokens`, `output_tokens`, `total_tokens`, `reasoning_tokens`, `cached_tokens`). No estimation needed.
3. **Multi-Phase SSE Stream**:
   - `response.created`: First event with `chat_id` and `response_id`.
   - `choices` chunks: `phase: "thinking_summary"` (reasoning array in `extra.summary_thought.content` + distinct `summary_title.content`) followed by `phase: "answer"` (`content`, `status: "typing"`).
   - Unknown tool phases are tolerated and preserved verbatim (`type: "tool"`).
   - Terminated by `status: "finished"`.
4. **Outbound `version` Header Policy**: Omit entirely until captured from a live page-originated request in Phase 1; never fabricate values.
5. **Chat Creation & Completion**:
   - Create: `POST /api/v2/chats/new` with `chatId: ""` and `chat_mode: "normal"`.
   - Complete: `POST /api/v2/chat/completions?chat_id={id}` with dual `chatId`/`chat_id` and `parentId`/`parent_id`.
6. **Model Catalog Baseline (§16)**:
   - `qwen3.7-plus` (Default flagship, 1M context, 65,536 output, hybrid thinking)
   - `qwen3.8-max` (1M context, 131,072 output, thinking)
   - `qwen3.7-max` (1M context, 65,536 output, 81,920 thinking tokens, text-only)
   - `qwen3.6-plus` (1M context, 65,536 output, hybrid thinking)
   - `qwen3.5-plus` (1M context, 65,536 output, hybrid thinking)
   - `qwen3.5-omni-plus` (256K context, 65,536 output, non-reasoning, native audio/video)

---

## 4. Unresolved Questions & Contradiction Ledger

| Item | Question | Current Evidence | Evidence Class | Verification Method | Why It Matters |
|---|---|---|---|---|---|
| **1** | Does guest mode still function on `chat.qwen.ai`? | Reference implementations used `chat_mode:'guest'`; `Research.md` tested account mode only. | `[FE]` / Unverified | Phase 2 probe (`scripts/probe-protocol.ts`) | Determines whether zero-config guest mode can be offered as a fallback. |
| **2** | What exact value does the web client send in the `version` request header? | Old refs sent `0.2.83`; frontend bundle is `0.2.87`; app is `0.4.4`. No outbound request header captured yet. | `[FE]` | Phase 1 request interception of real browser traffic | Prevents header mismatch triggering WAF or schema rejection. |
| **3** | Will `POST /api/v2/chats/new` accept both researched and legacy body shapes? | Researched shape has `chatId` and no `title`; legacy has `title: "新建对话"`. | `[NET]` | Phase 2 probe | Sets primary vs fallback request shape in `ChatsNewBody`. |
| **4** | Can image URLs be reliably extracted from `t2i` completion streams? | Flagship models report `t2i` chat type `[NET]`, but stream event extraction is based on old refs. | `[NET]` / `[FE]` | Phase 2 live `t2i` round-trip probe | `/v1/images/generations` ships only if probe passes; otherwise clean 501. |
| **5** | What is the operational TTL of Alibaba baxia tokens (`ssxmod_itna`, `isg`, `tfstk`)? | JWT lasts ~30 days, but baxia WAF cookies rotate dynamically. | `[INF]` | Continuous profile observation over 24h | Determines background harvesting schedule and cooldown rules. |

---

## 5. Top Risks & Mitigations (Ranked)

1. **Alibaba Baxia / WAF / Risk Controls**:
   *Risk*: Pure HTTP requests without fresh baxia cookies trigger `FAIL_SYS_USER_VALIDATE` or CAPTCHA.
   *Mitigation*: Persistent CloakBrowser profiles (`launchPersistentContext`) capture full fat cookie jars; browser-transport fallback executes in page context when HTTP encounters WAF.

2. **Retry Storms Under Upstream Outages**:
   *Risk*: Uncontrolled retries against rate limits or cloud outages exhaust accounts and CPU.
   *Mitigation*: Enforce plan §4.9 request-level retry budget: max 4 attempts, max 2 account rotations, max 1 browser fallback, max 60s wall clock.

3. **Model Catalog & Endpoint Drift**:
   *Risk*: Upstream changes model IDs, context limits, or endpoint paths without notice.
   *Mitigation*: ModelRegistry live sync (`GET /api/v2/models/`) over static snapshot (`config/qwen-models.snapshot.json`); drift logging to `data/drift.log`; unknown models rejected with 404 unless `ALLOW_UNKNOWN_MODELS=true`.

4. **CloakBrowser Binary Availability in Restricted Environments**:
   *Risk*: Automated binary download from `cloakbrowser.dev` fails in environments with egress filtering.
   *Mitigation*: Diagnostic script `scripts/check-cloakbrowser.ts` tests availability; support `CLOAKBROWSER_BINARY_PATH` override for pre-provisioned binaries.

5. **Cross-Platform Consistency (Linux dev vs Windows deployment)**:
   *Risk*: Path separators, CDP pipes, and browser process signals differ between Windows and Linux.
   *Mitigation*: Pure Node standard library path resolution (`node:path`), platform-agnostic configuration, and avoidance of shell-specific wrappers.

---

## 6. Exact Verification Results (Gate 0)

1. **Native Compilation & Dependencies**:
   ```bash
   NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt npm_config_nodedir=/usr/local npm install
   ```
   *Result*: 0 errors, 106 packages installed, `better-sqlite3` compiled natively.

2. **TypeScript Compilation Check**:
   ```bash
   npx tsc --noEmit
   ```
   *Result*: 0 errors, clean check under `exactOptionalPropertyTypes: true` and `noUncheckedIndexedAccess: true`.

3. **Vitest Unit Test Suite**:
   ```bash
   npx vitest run
   ```
   *Result*: 2/2 test files passed, 9/9 tests passed.
   - `tests/unit/snapshot.test.ts`: Pins 6 model IDs and limits vs `Research.md §16` (3 tests passed).
   - `tests/unit/contracts.test.ts`: Validates `contracts.ts`, `openai.ts`, and `qwen.ts` (6 tests passed).

4. **CloakBrowser Diagnostics**:
   ```bash
   npx tsx scripts/check-cloakbrowser.ts
   ```
   *Result*: Clean JSON diagnostic report; confirms `cloakbrowser@0.5.9` import and target Chromium `146.0.7680.177.5`.

---

## 7. Current Gate Status & Hold

- **Gate 0 (reproducible Node/TypeScript baseline)**: **COMPLETE**.
- **Gate 1 (CloakBrowser launches) & Gate 2 (authenticated persistent session)**: **HELD**.
  *Per explicit operator instruction: "do not proceed to gate 1 or 2 until i say."*
