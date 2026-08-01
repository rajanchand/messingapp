/** Chat roles supported by OpenAI-compatible APIs. */
export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Required when role is "tool". */
  toolCallId?: string;
  /** Tool name when role is "tool". */
  name?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  /** JSON-encoded arguments object. */
  arguments: string;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
}

export interface ChatResponse {
  content: string | null;
  toolCalls?: ToolCall[];
}

/** Minimal LLM abstraction — implementations must not execute admin side effects. */
export interface LlmProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  /** When false, callers should use offline/heuristic fallbacks. */
  isConfigured(): boolean;
}
