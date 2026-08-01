import type { ChatRequest, ChatResponse, LlmProvider } from "./types";

export interface OpenAiCompatibleProviderOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  fetchFn?: typeof fetch;
}

/**
 * OpenAI-compatible chat completions client.
 * Configure via AI_BASE_URL, AI_API_KEY, AI_MODEL (or constructor options).
 */
export class OpenAiCompatibleProvider implements LlmProvider {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAiCompatibleProviderOptions = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.AI_BASE_URL ?? "https://api.openai.com/v1").replace(
      /\/+$/,
      "",
    );
    this.apiKey = options.apiKey ?? process.env.AI_API_KEY ?? "";
    this.model = options.model ?? process.env.AI_MODEL ?? "gpt-4o-mini";
    this.fetchFn = options.fetchFn ?? fetch;
  }

  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.isConfigured()) {
      throw new Error("AI_API_KEY is not configured");
    }

    const body: Record<string, unknown> = {
      model: this.model,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
        ...(m.name ? { name: m.name } : {}),
      })),
      temperature: 0.2,
    };
    if (request.tools?.length) {
      body.tools = request.tools;
    }

    const res = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LLM error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      choices?: {
        message?: {
          content?: string | null;
          tool_calls?: { id: string; function: { name: string; arguments: string } }[];
        };
      }[];
    };
    const message = json.choices?.[0]?.message;
    return {
      content: message?.content ?? null,
      toolCalls: message?.tool_calls?.map((tc) => ({
        id: tc.id,
        name: tc.function.name,
        arguments: tc.function.arguments,
      })),
    };
  }
}

export function getDefaultLlmProvider(): LlmProvider {
  return new OpenAiCompatibleProvider();
}
