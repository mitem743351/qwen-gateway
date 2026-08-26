/**
 * src/types/qwen.ts
 *
 * Upstream wire shapes for chat.qwen.ai endpoints (Research §5–§7, plan §4).
 */

export interface ChatsNewBody {
  chatId: string;
  models: string[];
  project_id: string;
  timestamp: number;
  chat_type: 't2t' | 't2i';
  chat_mode: 'normal' | 'guest';
}

export interface ChatsNewResponse {
  success: boolean;
  data: {
    id: string;
  };
}

export interface WireFeatureConfig {
  thinking_enabled: boolean;
  output_schema: 'phase';
  instructions?: string | null;
  research_mode: 'normal';
  auto_thinking: boolean;
  thinking_mode: 'Auto' | 'Thinking' | 'Fast';
  thinking_format: 'summary';
  auto_search: boolean;
}

export interface WireMessageItem {
  id?: string | null;
  fid: string;
  parentId?: string | null;
  childrenIds?: string[];
  role: 'user' | 'assistant';
  content: string;
  chat_type: 't2t' | 't2i';
  model: string;
  status: 'completed' | 'typing';
  user_action?: string;
  contentType: 'text';
  files?: unknown[];
  feature_config?: WireFeatureConfig;
}

export interface ChatCompletionsBody {
  stream: true;
  version: '2.1';
  incremental_output: true;
  chatId: string;
  chat_id: string;
  parentId?: string | null;
  parent_id?: string | null;
  chat_mode: 'normal' | 'guest';
  model: string;
  messages: WireMessageItem[];
  timestamp: number;
}

export interface ResponseCreated {
  chat_id: string;
  parent_id?: string | null;
  response_id: string;
  response_index: string;
}

export interface StreamDeltaExtra {
  summary_title?: { content: string[] };
  summary_thought?: { content: string[] };
  [key: string]: unknown;
}

export interface StreamDelta {
  role?: 'assistant';
  content?: string;
  phase?: 'thinking_summary' | 'answer' | string;
  status?: 'typing' | 'finished';
  extra?: StreamDeltaExtra;
  function_id?: string;
  function_call?: {
    name: string;
    arguments: string;
  };
}

export interface WireUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  characters?: number;
  input_tokens_details?: {
    text_tokens?: number;
  };
  output_tokens_details?: {
    text_tokens?: number;
    reasoning_tokens?: number;
  };
  prompt_tokens_details?: {
    cached_tokens?: number;
  };
}

export interface WireModelMeta {
  capabilities?: {
    vision?: boolean;
    document?: boolean;
    video?: boolean;
    audio?: boolean;
    thinking?: boolean;
    search?: boolean;
  };
  max_context_length?: number;
  max_summary_generation_length?: number;
  max_generation_length?: number;
  max_thinking_generation_length?: number;
  modality?: string[];
  chat_type?: string[];
  think_skip?: {
    enable?: boolean;
  };
}

export interface WireModel {
  id: string;
  info?: {
    meta?: WireModelMeta;
  };
}
