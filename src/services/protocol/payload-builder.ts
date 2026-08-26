/**
 * src/services/protocol/payload-builder.ts
 *
 * Constructs request payloads for upstream chat.qwen.ai endpoints.
 * Conforms to Research.md §5–§7 and plan.md §4.
 */

import { randomUUID } from 'node:crypto';
import type { ChatRequest, IncomingMessage } from '../../types/contracts.js';
import type {
  ChatCompletionsBody,
  ChatsNewBody,
  WireFeatureConfig,
  WireMessageItem,
} from '../../types/qwen.js';

export interface PayloadBuilderOptions {
  chatId?: string;
  legacyChatsNew?: boolean;
  guestMode?: boolean;
}

/**
 * Builds the payload for POST /api/v2/chats/new
 */
export function buildChatsNewPayload(
  model: string,
  options: PayloadBuilderOptions = {},
): ChatsNewBody | Record<string, unknown> {
  const mode = options.guestMode ? 'guest' : 'normal';

  if (options.legacyChatsNew) {
    return {
      title: '新建对话',
      models: [model],
      chat_type: 't2t',
      chat_mode: mode,
      timestamp: Date.now(),
    };
  }

  return {
    chatId: '',
    models: [model],
    project_id: '',
    timestamp: Date.now(),
    chat_type: 't2t',
    chat_mode: mode,
  };
}

/**
 * Normalizes incoming chat messages to string content.
 */
function normalizeMessageContent(msg: IncomingMessage): string {
  if (typeof msg.content === 'string') {
    return msg.content;
  }
  return msg.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
}

/**
 * Maps reasoning effort to Qwen wire thinking_mode.
 */
function mapReasoningMode(
  effort?: ChatRequest['reasoningEffort'],
): 'Auto' | 'Thinking' | 'Fast' {
  switch (effort) {
    case 'none':
      return 'Fast';
    case 'high':
      return 'Thinking';
    case 'low':
    case 'medium':
    default:
      return 'Auto';
  }
}

/**
 * Builds the payload for POST /api/v2/chat/completions?chat_id={id}
 */
export function buildChatCompletionsPayload(
  req: ChatRequest,
  chatId: string,
  options: PayloadBuilderOptions = {},
): ChatCompletionsBody {
  const mode = options.guestMode ? 'guest' : 'normal';
  const thinkingMode = mapReasoningMode(req.reasoningEffort);

  const featureConfig: WireFeatureConfig = {
    thinking_enabled: req.reasoningEffort !== 'none',
    output_schema: 'phase',
    instructions: null,
    research_mode: 'normal',
    auto_thinking: req.reasoningEffort !== 'none',
    thinking_mode: thinkingMode,
    thinking_format: 'summary',
    auto_search: false, // v1 forces false for determinism
  };

  // Convert incoming messages into Qwen wire format
  const wireMessages: WireMessageItem[] = req.messages.map((m) => {
    const content = normalizeMessageContent(m);
    const isUser = m.role === 'user';

    const item: WireMessageItem = {
      id: null,
      fid: randomUUID(),
      parentId: null,
      childrenIds: [],
      role: isUser ? 'user' : 'assistant',
      content,
      chat_type: 't2t',
      model: req.model,
      status: 'completed',
      contentType: 'text',
      files: [],
    };
    if (isUser) {
      item.user_action = 'chat';
      item.feature_config = featureConfig;
    }
    return item;
  });

  return {
    stream: true,
    version: '2.1',
    incremental_output: true,
    chatId,
    chat_id: chatId,
    parentId: '',
    parent_id: null,
    chat_mode: mode,
    model: req.model,
    messages: wireMessages,
    timestamp: Date.now(),
  };
}
