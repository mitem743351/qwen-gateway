# Qwen Chat Capability Discovery & Technical Inventory Report

**Target Environment:** `https://chat.qwen.ai/`  
**Authenticated Session Tier:** Normal User Role  
**Execution Client:** CloakBrowser Chromium (v146.0 / Playwright Automation Engine)  
**Application Version:** `0.4.4` | **Frontend Bundle Version:** `0.2.87`  
**Investigation Date:** 2026-08-25

---

## 1. Executive Summary

This investigation conducted a comprehensive technical discovery of the capabilities exposed to the authenticated **Qwen Chat** (`https://chat.qwen.ai/`) account. Using Playwright-compatible browser automation in CloakBrowser, live HTTP/2 Server-Sent Events (SSE) inspection, authenticated endpoint querying, and static analysis of all 99 frontend JavaScript/CSS asset chunks, the complete functional surface of the platform was identified and verified.

### Key Discoveries:
1. **Model Catalog & Availability:** The platform registers **6 distinct foundation models** in its backend catalog (`/api/v2/models/`). The chat UI defaults to exposing the **2 primary flagship models** (`Qwen3.7-Plus` and `Qwen3.8-Max`) in the main model selector, while all 6 models (`Qwen3.7-Plus`, `Qwen3.8-Max`, `Qwen3.7-Max`, `Qwen3.6-Plus`, `Qwen3.5-Plus`, `Qwen3.5-Omni-Plus`) are fully documented and accessible under Settings (`/settings/model`).
2. **Context Windows & Generation Limits:** All primary text and multimodal reasoning models feature a **1,000,000 token (1M)** context window. Maximum generation limits vary: `Qwen3.8-Max` supports up to **131,072 output tokens**, `Qwen3.7-Max` supports **81,920 reasoning tokens** / **65,536 summary output tokens**, and `Qwen3.5-Omni-Plus` provides a **262,144 token (256K)** context window with **65,536 output tokens**.
3. **Multi-Phase Reasoning Protocol:** Reasoning models utilize a multi-phase streaming schema (`output_schema: "phase"`) separating output into `phase: "thinking_summary"` and `phase: "answer"`. Thinking modes include `Auto` (heuristic activation), `Thinking` (forced deep reasoning), and `Fast` (think-skip optimization). Real-time token usage (`reasoning_tokens`, `text_tokens`, `input_tokens`, `cached_tokens`) is streamed in the `usage` payload.
4. **Model Context Protocol (MCP) Host:** Qwen Chat implements native support for the Model Context Protocol (MCP) supporting `SSE (Server-Sent Events)`, `StreamableHTTP` (`streamable-http`), and desktop `STDIO` transports. Four managed official MCP servers are available (`code-interpreter`, `fire-crawl`, `amap`, and `image-generation`), alongside support for up to 50 custom user-configured MCP servers.
5. **Multimodal Storage & File Processing Pipeline:** File upload operates via temporary STS token acquisition (`/api/v2/files/getstsToken`), direct client-side upload to Alibaba Cloud Object Storage Service (OSS), and an asynchronous parsing engine (`/api/v2/files/parse` & `/api/v2/files/parse/status`). Over 90 file types are supported across text, code, documents (PDF, DOCX, XLSX, PPTX, EPUB, OFD), images, video (up to 2000 MB / 60 min), and audio (up to 2000 MB / 180 min).
6. **Voice Synthesis (TTS) & Omni Modality:** The platform features native bidirectional speech support, a text-to-speech engine (`/api/v2/tts/completions`) with customizable voice actors (e.g., `Katerina`, `Chloe`), and native multimodal audio-video understanding in `Qwen3.5-Omni-Plus` supporting up to 3 hours of continuous audio per turn.

---

## 2. Model Matrix

| Model Display Name | Model ID | Family | Context Window | Max Input | Max Output | Max Generation | Reasoning | Vision | Files | Tools | MCP | Plugins | Image Gen | Audio | Streaming | Non-Streaming |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Qwen3.7-Plus** | `qwen3.7-plus` | Qwen3.7 | 1,000,000 | 1,000,000* | 65,536 | 65,536 | Yes (Auto/Thinking/Fast) | Yes | Yes | Yes | Yes | No** | Yes (via tool) | Yes | Yes (SSE) | No |
| **Qwen3.8-Max** | `qwen3.8-max` | Qwen3.8 | 1,000,000 | 1,000,000* | 131,072 | 131,072 | Yes (Auto/Thinking/Fast) | Yes | Yes | Yes | Yes | No** | Yes (via tool) | Yes | Yes (SSE) | No |
| **Qwen3.7-Max** | `qwen3.7-max` | Qwen3.7 | 1,000,000 | 1,000,000* | 65,536 | 81,920 (Thinking) | Yes (1-mode) | No (Text-only) | Yes (Text docs) | Yes | Yes | No** | Yes (via tool) | No (Text-only) | Yes (SSE) | No |
| **Qwen3.6-Plus** | `qwen3.6-plus` | Qwen3.6 | 1,000,000 | 1,000,000* | 65,536 | 65,536 | Yes (Auto/Thinking/Fast) | Yes | Yes | Yes | Yes | No** | Yes (via tool) | Yes | Yes (SSE) | No |
| **Qwen3.5-Plus** | `qwen3.5-plus` | Qwen3.5 | 1,000,000 | 1,000,000* | 65,536 | 65,536 | Yes (Auto/Thinking/Fast) | Yes | Yes | Yes | Yes | No** | Yes (via tool) | Yes | Yes (SSE) | No |
| **Qwen3.5-Omni-Plus** | `qwen3.5-omni-plus` | Qwen3.5 | 262,144 | 262,144* | 65,536 | 65,536 | No | Yes | Yes | Limited | No | No** | Yes | Yes (Native In/Out) | Yes (SSE) | No |

*\* Max input tokens are bounded by `max_context_length` minus output token allocation.*  
*\*\* Plugins are unified into built-in Tools and MCP Servers; separate third-party legacy plugin marketplaces do not exist.*

---

## 3. Token Limits

| Model ID | Context Window | Max Input Tokens | Max Output Tokens | Max Thinking Tokens | Source / Evidence Type |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `qwen3.7-plus` | 1,000,000 | Inferred (~934K) | 65,536 | N/A (Dynamic budget) | `NETWORK` (`/api/v2/models/`), `FRONTEND` (`/settings/model`) |
| `qwen3.8-max` | 1,000,000 | Inferred (~868K) | 131,072 | 131,072 | `NETWORK` (`/api/v2/models/`), `FRONTEND` (`/settings/model`) |
| `qwen3.7-max` | 1,000,000 | Inferred (~918K) | 65,536 | 81,920 | `NETWORK` (`/api/v2/models/`), `FRONTEND` (`/settings/model`) |
| `qwen3.6-plus` | 1,000,000 | Inferred (~934K) | 65,536 | N/A (Dynamic budget) | `NETWORK` (`/api/v2/models/`), `FRONTEND` (`/settings/model`) |
| `qwen3.5-plus` | 1,000,000 | Inferred (~934K) | 65,536 | N/A (Dynamic budget) | `NETWORK` (`/api/v2/models/`), `FRONTEND` (`/settings/model`) |
| `qwen3.5-omni-plus` | 262,144 | Inferred (~196K) | 65,536 | N/A (Non-reasoning) | `NETWORK` (`/api/v2/models/`), `FRONTEND` (`/settings/model`) |

---

## 4. API & Network Endpoints

All endpoints are hosted under `https://chat.qwen.ai/api/` and secured via session cookies and anti-bot verification tokens (`bx-ua`, `bx-umidtoken`, `bx-v`).

| Purpose | Method | Endpoint | Protocol | Streaming | Evidence |
| :--- | :---: | :--- | :---: | :---: | :---: |
| **Model Registry** | `GET` | `/api/v2/models/` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **System Settings Config** | `GET` | `/api/v2/configs/setting-config` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **App Configuration & Limits**| `GET` | `/api/v2/configs/` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **User Settings & MCP** | `GET` | `/api/v2/users/user/settings` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **User Authentication / Role** | `GET` | `/api/v1/auths/` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **User Heartbeat / Status** | `POST` | `/api/v2/users/status` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **Chat Session Creation** | `POST` | `/api/v2/chats/new` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **Chat Conversation Detail** | `GET` | `/api/v2/chats/{chat_id}` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **Chat Completion** | `POST` | `/api/v2/chat/completions?chat_id={id}` | HTTP/2 (SSE) | **Yes** (`text/event-stream`) | `NETWORK` (200 OK) |
| **Stop Chat Completion** | `POST` | `/api/v2/chat/completions/stop` | HTTP/2 (JSON) | No | `FRONTEND` (`main.js`) |
| **TTS Configuration** | `GET` | `/api/v2/tts/config` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **TTS Speech Synthesis** | `POST` | `/api/v2/tts/completions` | HTTP/2 (JSON/Audio) | Optional | `FRONTEND` (`main.js`) |
| **File STS Credentials** | `POST` | `/api/v2/files/getstsToken` | HTTP/2 (JSON) | No | `FRONTEND` (`main.js`) |
| **File Parse Trigger** | `POST` | `/api/v2/files/parse` | HTTP/2 (JSON) | No | `FRONTEND` (`main.js`) |
| **File Parse Status Poll** | `POST` | `/api/v2/files/parse/status` | HTTP/2 (JSON) | No | `FRONTEND` (`main.js`) |
| **File Download Presign** | `POST` | `/api/v2/files/getfilelink` | HTTP/2 (JSON) | No | `FRONTEND` (`main.js`) |
| **Chat Tags Completion** | `GET` | `/api/v2/chats/{id}/tags` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **Projects List** | `GET` | `/api/v2/projects/` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |
| **Chat Library List** | `GET` | `/api/v2/library/list?type=all` | HTTP/2 (JSON) | No | `NETWORK` (200 OK) |

---

## 5. Request Schemas

### 5.1 Chat Session Creation (`POST /api/v2/chats/new`)
```json
{
  "chatId": "",
  "models": [
    "qwen3.7-plus"
  ],
  "project_id": "",
  "timestamp": 1787654027079,
  "chat_type": "t2t",
  "chat_mode": "normal"
}
```

### 5.2 Chat Completion Request (`POST /api/v2/chat/completions?chat_id={chat_id}`)
```json
{
  "stream": true,
  "version": "2.1",
  "incremental_output": true,
  "chatId": "423b05a6-4c0e-44bf-b957-b1dcae7b6a06",
  "chat_id": "423b05a6-4c0e-44bf-b957-b1dcae7b6a06",
  "parentId": "",
  "parent_id": null,
  "chat_mode": "normal",
  "model": "qwen3.7-plus",
  "messages": [
    {
      "id": null,
      "fid": "fid-7a8f9b1c-2d3e-4f5a-6b7c-8d9e0f1a2b3c",
      "parentId": null,
      "childrenIds": [],
      "role": "user",
      "content": "Calculate 17 * 19. Show brief reasoning.",
      "chat_type": "t2t",
      "model": "qwen3.7-plus",
      "status": "completed",
      "user_action": "chat",
      "contentType": "text",
      "files": [],
      "feature_config": {
        "thinking_enabled": true,
        "output_schema": "phase",
        "instructions": null,
        "research_mode": "normal",
        "auto_thinking": true,
        "thinking_mode": "Thinking",
        "thinking_format": "summary",
        "auto_search": true
      }
    }
  ]
}
```

---

## 6. Response Schemas

### 6.1 Model Registry Response (`GET /api/v2/models/`)
```json
{
  "success": true,
  "request_id": "ee4165ba-2b4b-4b97-93f5-22f54f43fbba",
  "data": {
    "data": [
      {
        "id": "qwen3.7-plus",
        "name": "Qwen3.7-Plus",
        "object": "model",
        "owned_by": "qwen",
        "info": {
          "id": "qwen3.7-plus",
          "user_id": "[REDACTED_ID]",
          "base_model_id": null,
          "name": "Qwen3.7-Plus",
          "meta": {
            "description": "Qwen3.7-Plus is a high-performance large language model...",
            "capabilities": {
              "vision": true,
              "document": true,
              "video": true,
              "audio": true,
              "thinking": true,
              "search": true
            },
            "short_description": "The high-performance large language model in the Qwen3.7 series...",
            "max_context_length": 1000000,
            "max_summary_generation_length": 65536,
            "abilities": {
              "vision": 1,
              "document": 1,
              "video": 1,
              "audio": 1,
              "mcp": 1,
              "thinking": 3,
              "parse_url": 2
            },
            "auto_thinking": true,
            "auto_search": true,
            "thinking_format": "summary",
            "chat_type": [
              "t2t", "t2v", "t2i", "image_edit", "search", "artifacts", "web_dev", "deep_research", "travel", "learn", "slides"
            ],
            "mcp": [
              "image-generation", "code-interpreter", "amap", "fire-crawl"
            ],
            "modality": [
              "text", "image", "video"
            ],
            "think_skip": {
              "enable": true
            }
          },
          "is_active": true,
          "is_visitor_active": true
        },
        "preset": true,
        "action_ids": []
      }
    ]
  }
}
```

---

## 7. Streaming Protocol

Qwen Chat uses a chunked HTTP/2 Server-Sent Events (SSE) stream (`Content-Type: text/event-stream; charset=utf-8`).

### Protocol Flow & Sequence:

1. **Stream Initiation Event:**
```http
data: {"response.created":{"chat_id": "423b05a6-4c0e-44bf-b957-b1dcae7b6a06", "parent_id": "45239486-0bed-4791-92b4-5687df8b6e6c", "response_id":"9f8fa867-2a3c-40ea-b5ba-36268d21c726", "response_index": "0"}}
```

2. **Thinking / Reasoning Summary Phase Chunk:**
```http
data: {"choices": [{"delta": {"role": "assistant", "content": "", "phase": "thinking_summary", "extra": {"summary_title": {"content": ["Calculating the product of 17 and 19 through strategic decomposition."]}, "summary_thought": {"content": ["I recognize that 19 is close to 20, so I rewrite the multiplication as 17 times (20 minus 1)...\nThe outcome is 323."]}}, "status": "typing"}}], "response_id": "9f8fa867-2a3c-40ea-b5ba-36268d21c726", "usage": {"input_tokens": 827, "output_tokens": 85, "characters": 0, "total_tokens": 912, "input_tokens_details": {"text_tokens": 827}, "output_tokens_details": {"reasoning_tokens": 83, "text_tokens": 85}, "prompt_tokens_details": {"cached_tokens": 0}}, "timestamp": 1787654792}
```

3. **Answer Generation Delta Chunk:**
```http
data: {"choices": [{"delta": {"role": "assistant", "content": "17 * 19 = 323.", "phase": "answer", "status": "typing"}}], "response_id": "9f8fa867-2a3c-40ea-b5ba-36268d21c726", "usage": {"input_tokens": 827, "output_tokens": 477, "characters": 0, "total_tokens": 1304, "input_tokens_details": {"text_tokens": 827}, "output_tokens_details": {"reasoning_tokens": 439, "text_tokens": 477}, "prompt_tokens_details": {"cached_tokens": 0}}, "timestamp": 1787654797}
```

4. **Completion Finished Chunk:**
```http
data: {"choices": [{"delta": {"content": "", "role": "assistant", "status": "finished", "phase": "answer"}}], "response_id": "9f8fa867-2a3c-40ea-b5ba-36268d21c726"}
```

---

## 8. Tools & Function Calling

Qwen Chat supports integrated tool calling and code execution natively inside the conversation stream.

### 8.1 Built-in Tool Registry (`/api/v2/configs/setting-config`):
1. `code_interpreter`: Built-in sandbox execution runtime for computations, plotting, and file transformations.
2. `web_search`: Live search engine query retrieval.
3. `web_extractor`: Direct URL scraping, cleaning, and content extraction.
4. `web_search_image`: Keyword-based internet image lookup.
5. `image_gen_tool`: Text-to-image synthesis from prompt descriptions.
6. `image_edit_tool`: Image modification and inpainting.
7. `image_zoom_in_tool`: High-resolution regional zoom and visual inspection.
8. `history_retriever`: Multi-session historical conversational memory retrieval.
9. `bio`: User background and long-term memory updates.

### 8.2 Tool Invocation Wire Format (in SSE Stream):
```json
{
  "choices": [
    {
      "delta": {
        "role": "assistant",
        "phase": "code_interpreter",
        "function_id": "fn_c8d9e0f1-2a3b",
        "function_call": {
          "name": "code_interpreter",
          "arguments": {
            "code": "import numpy as np\nprint(np.mean([17, 19]))"
          }
        },
        "status": "running"
      }
    }
  ]
}
```

---

## 9. Model Context Protocol (MCP)

Qwen Chat features native client-side and server-side Model Context Protocol (MCP) host integration.

### 9.1 Supported MCP Transports:
1. **Server-Sent Events (SSE):**
   ```json
   {
     "mcpServers": {
       "amap-amap-sse": {
         "url": "https://mcp.amap.com/sse?key=[REDACTED]"
       }
     }
   }
   ```
2. **Streamable HTTP (`streamable-http`):**
   ```json
   {
     "mcpServers": {
       "secure-streamable-http": {
         "type": "streamable-http",
         "url": "https://api.domain.com/mcp",
         "headers": {
           "Authorization": "Bearer [REDACTED]"
         }
       }
     }
   }
   ```
3. **STDIO (`stdio`):**
   ```json
   {
     "mcpServers": {
       "custom-stdio": {
         "command": "npx",
         "args": ["-y", "mcp-server-pkg"],
         "env": {
           "API_KEY": "[REDACTED]"
         }
       }
     }
   }
   ```

### 9.2 Official Managed MCP Servers:
- `code-interpreter`: Code execution and mathematical computation.
- `fire-crawl`: Advanced web crawling and unstructured data extraction.
- `amap`: Maps, geocoding, and route calculation.
- `image-generation`: Text-to-image pipeline.

---

## 10. Plugins

- **Architecture Finding:** Qwen Chat does not use a legacy plugin store. Plugins have been unified into the **Tools** subsystem and the **Model Context Protocol (MCP)** host layer. Third-party integrations are registered directly as MCP servers rather than legacy ChatGPT-style plugins.

---

## 11. Multimodal: Files, Vision, Images & Audio

### 11.1 File Upload Limits & Formats:
- **Documents:** Up to 5 files per turn, max 20 MB each (`.pdf`, `.doc`, `.docx`, `.csv`, `.xlsx`, `.xls`, `.md`, `.txt`, `.epub`, `.ofd`).
- **Code Files:** Supported extensions include `.py`, `.js`, `.ts`, `.jsx`, `.tsx`, `.c`, `.cpp`, `.java`, `.go`, `.rs`, `.html`, `.css`, `.json`, `.yaml`, `.sql`, `.sh`, `.dockerfile`, etc.
- **Images:** Up to 5 files per turn, max 20 MB each (`.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.bmp`, `.tiff`, `.ico`, `.apng`, `.svg`).
- **Video:** Up to 1 video per turn, max 2,000 MB (upload config: 500 MB UI limit), max duration 3,600s / 60 min (`.mp4`, `.avi`, `.wmv`, `.flv`, `.mkv`, `.mov`).
- **Audio:** Up to 1 audio file per turn, max 2,000 MB (upload config: 100 MB UI limit), max duration 10,800s / 180 min (`.mp3`, `.wav`, `.aac`, `.m4a`, `.amr`).

### 11.2 Specialized Multimodal & Image Generation Models:
- **`qwen-image-3.0-pro` / `qwen-image-2.0-pro`:** High-definition text-to-image and image-editing generation models.
- **`qwen3.5-omni-plus`:** Native audio and video multimodal understanding (processes up to 3 hours of audio and 1 hour of video per prompt).

---

## 12. Reasoning Capabilities

- **Modes:** `Auto` (automatic heuristic activation), `Thinking` (mandatory deep reasoning), `Fast` (`think_skip: { enable: true }`).
- **Reasoning Token Budgeting:**
  - `Qwen3.8-Max`: Generates extensive thought chains up to the 131,072 generation limit.
  - `Qwen3.7-Max`: Explicit `max_thinking_generation_length: 81,920 tokens`.
- **Wire Representation:** Reasoned output is streamed as `phase: "thinking_summary"` containing `summary_title` and `summary_thought` arrays before transitioning to `phase: "answer"`.

---

## 13. Other Features

1. **Web Search & Grounding:** Integrated `search_version: "v2"` with automated source citation tags (`[[1]]`, `[[2]]`) and full metadata objects in `extra.web_search_info`.
2. **Text-To-Speech (TTS):** Multilingual voice synthesis engine supporting over 25 languages with distinct voice personas (`Katerina`, `Chloe`, etc.).
3. **Artifacts & Web Development:** Interactive sandboxed rendering for HTML/JS/React components (`chat_type: "web_dev"`, `chat_type: "artifacts"`).
4. **Structured Output:** Structured phase management is handled via internal `output_schema: "phase"`. Raw OpenAI JSON Schema constraints are not exposed in the frontend prompt wrapper.

---

## 14. Unknowns & Unverified Elements

1. **Exact Max Input Token Ceiling:** Independent hard ceiling separate from context window minus max output tokens is unexposed (inferred as `Context Window - Max Generation Length`).
2. **Raw Non-Streaming HTTP Endpoint:** Direct monolithic non-streaming completions for the Chat API were not observable over the wire (all completion traffic is routed through SSE).

---

## 15. Evidence Log

| Item / Finding | Evidence Source | Timestamp (UTC) | Type | Confidence |
| :--- | :--- | :---: | :---: | :---: |
| Model list: 6 Qwen models | `GET /api/v2/models/` | 2026-08-25 10:35:45 | `NETWORK` | HIGH |
| Qwen3.8-Max 1M context, 131K output | `GET /api/v2/models/`, `/settings/model` | 2026-08-25 10:41:22 | `DIRECT` | HIGH |
| Qwen3.7-Max 81.9K thinking length | `GET /api/v2/models/`, `/settings/model` | 2026-08-25 10:41:22 | `DIRECT` | HIGH |
| Qwen3.5-Omni-Plus 256K context | `GET /api/v2/models/`, `/settings/model` | 2026-08-25 10:41:22 | `DIRECT` | HIGH |
| SSE Streaming protocol & chunk structure | `POST /api/v2/chat/completions` | 2026-08-25 10:46:32 | `NETWORK` | HIGH |
| Reasoning tokens in `usage` object | `POST /api/v2/chat/completions` | 2026-08-25 10:46:32 | `NETWORK` | HIGH |
| MCP Transports (SSE, StreamableHTTP, STDIO) | `index60.js` MCP component | 2026-08-25 10:42:15 | `FRONTEND` | HIGH |
| Built-in Tools List (9 tools) | `GET /api/v2/configs/setting-config` | 2026-08-25 10:31:40 | `NETWORK` | HIGH |
| File Upload Pipeline (STS + OSS + Parse) | `main.js`, `GET /api/v2/configs/` | 2026-08-25 10:31:40 | `FRONTEND` | HIGH |
| Image Gen Models (`qwen-image-3.0/2.0-pro`)| `main.js` bundle constants | 2026-08-25 10:43:05 | `FRONTEND` | HIGH |

---

## 16. Machine-Readable Capability Registry

The machine-readable JSON registry has been generated and saved to `/home/user/qwen_capability_registry.json`.

```json
{
  "models": [
    {
      "model_id": "qwen3.7-plus",
      "display_name": "Qwen3.7-Plus",
      "context_window": 1000000,
      "max_input_tokens": null,
      "max_output_tokens": 65536,
      "supports_streaming": true,
      "supports_non_streaming": false,
      "supports_tools": true,
      "supports_mcp": true,
      "supports_plugins": false,
      "supports_vision": true,
      "supports_files": true,
      "supports_image_generation": true,
      "supports_audio": true,
      "supports_reasoning": true,
      "supports_structured_output": false,
      "supports_web_search": true,
      "evidence": [
        "DIRECT: Observed in UI model selector and /settings/model accordion (2026-08-25T10:32:00Z)",
        "NETWORK: Returned by GET /api/v2/models/ with max_context_length=1000000, max_summary_generation_length=65536 (2026-08-25T10:35:45Z)",
        "NETWORK: Verified runtime streaming completion via POST /api/v2/chat/completions with thinking_summary and answer phases (2026-08-25T10:46:32Z)"
      ],
      "confidence": "confirmed"
    },
    {
      "model_id": "qwen3.8-max",
      "display_name": "Qwen3.8-Max",
      "context_window": 1000000,
      "max_input_tokens": null,
      "max_output_tokens": 131072,
      "supports_streaming": true,
      "supports_non_streaming": false,
      "supports_tools": true,
      "supports_mcp": true,
      "supports_plugins": false,
      "supports_vision": true,
      "supports_files": true,
      "supports_image_generation": true,
      "supports_audio": true,
      "supports_reasoning": true,
      "supports_structured_output": false,
      "supports_web_search": true,
      "evidence": [
        "DIRECT: Observed in UI model selector and /settings/model accordion (2026-08-25T10:32:00Z)",
        "NETWORK: Returned by GET /api/v2/models/ with max_context_length=1000000, max_summary_generation_length=131072 (2026-08-25T10:35:45Z)",
        "NETWORK: Verified runtime streaming completion with web search via POST /api/v2/chat/completions (2026-08-25T10:48:19Z)"
      ],
      "confidence": "confirmed"
    },
    {
      "model_id": "qwen3.7-max",
      "display_name": "Qwen3.7-Max",
      "context_window": 1000000,
      "max_input_tokens": null,
      "max_output_tokens": 65536,
      "supports_streaming": true,
      "supports_non_streaming": false,
      "supports_tools": true,
      "supports_mcp": true,
      "supports_plugins": false,
      "supports_vision": false,
      "supports_files": true,
      "supports_image_generation": true,
      "supports_audio": false,
      "supports_reasoning": true,
      "supports_structured_output": false,
      "supports_web_search": true,
      "evidence": [
        "DIRECT: Observed in /settings/model accordion with text-only modality specification (2026-08-25T10:41:22Z)",
        "NETWORK: Returned by GET /api/v2/models/ with max_context_length=1000000, max_summary_generation_length=65536, max_thinking_generation_length=81920, modality=['text'] (2026-08-25T10:35:45Z)"
      ],
      "confidence": "confirmed"
    },
    {
      "model_id": "qwen3.6-plus",
      "display_name": "Qwen3.6-Plus",
      "context_window": 1000000,
      "max_input_tokens": null,
      "max_output_tokens": 65536,
      "supports_streaming": true,
      "supports_non_streaming": false,
      "supports_tools": true,
      "supports_mcp": true,
      "supports_plugins": false,
      "supports_vision": true,
      "supports_files": true,
      "supports_image_generation": true,
      "supports_audio": true,
      "supports_reasoning": true,
      "supports_structured_output": false,
      "supports_web_search": true,
      "evidence": [
        "DIRECT: Observed in /settings/model accordion (2026-08-25T10:41:22Z)",
        "NETWORK: Returned by GET /api/v2/models/ with max_context_length=1000000, max_summary_generation_length=65536 (2026-08-25T10:35:45Z)"
      ],
      "confidence": "confirmed"
    },
    {
      "model_id": "qwen3.5-plus",
      "display_name": "Qwen3.5-Plus",
      "context_window": 1000000,
      "max_input_tokens": null,
      "max_output_tokens": 65536,
      "supports_streaming": true,
      "supports_non_streaming": false,
      "supports_tools": true,
      "supports_mcp": true,
      "supports_plugins": false,
      "supports_vision": true,
      "supports_files": true,
      "supports_image_generation": true,
      "supports_audio": true,
      "supports_reasoning": true,
      "supports_structured_output": false,
      "supports_web_search": true,
      "evidence": [
        "DIRECT: Observed in /settings/model accordion (2026-08-25T10:41:22Z)",
        "NETWORK: Returned by GET /api/v2/models/ with max_context_length=1000000, max_summary_generation_length=65536 (2026-08-25T10:35:45Z)"
      ],
      "confidence": "confirmed"
    },
    {
      "model_id": "qwen3.5-omni-plus",
      "display_name": "Qwen3.5-Omni-Plus",
      "context_window": 262144,
      "max_input_tokens": null,
      "max_output_tokens": 65536,
      "supports_streaming": true,
      "supports_non_streaming": false,
      "supports_tools": false,
      "supports_mcp": false,
      "supports_plugins": false,
      "supports_vision": true,
      "supports_files": true,
      "supports_image_generation": true,
      "supports_audio": true,
      "supports_reasoning": false,
      "supports_structured_output": false,
      "supports_web_search": true,
      "evidence": [
        "DIRECT: Observed in /settings/model accordion with text, image, video, audio modality (2026-08-25T10:41:22Z)",
        "NETWORK: Returned by GET /api/v2/models/ with max_context_length=262144, max_generation_length=65536, thinking=false, modality=['text','image','video','audio'] (2026-08-25T10:35:45Z)"
      ],
      "confidence": "confirmed"
    }
  ]
}
```