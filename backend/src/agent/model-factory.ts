import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { convertToOpenAITool } from "@langchain/core/utils/function_calling";
import { toGeminiSchema } from "./gemini-schema";

/**
 * Gemini chat model that converts every tool's JSON Schema into the subset Gemini accepts
 * before binding (deepagents' built-in tools use nullable / defaulted fields that Gemini rejects).
 * Tool execution is unchanged: only the declarations sent to the API are rewritten.
 */
export class GeminiToolCompatibleChat extends ChatGoogleGenerativeAI {
  override bindTools(tools: any[], kwargs?: any): any {
    const functionDeclarations = tools.map((t) => {
      const fn = convertToOpenAITool(t).function;
      return { name: fn.name, description: fn.description ?? "", parameters: toGeminiSchema(fn.parameters ?? { type: "object", properties: {} }) };
    });
    return super.bindTools([{ functionDeclarations }] as any, kwargs);
  }
}

/** Turn a "provider:model" string into a model; Gemini gets the schema-compatible wrapper. */
export function createChatModel(spec: string | undefined): any {
  if (!spec) return spec;
  if (spec.startsWith("google-genai:")) {
    return new GeminiToolCompatibleChat({ model: spec.slice("google-genai:".length), maxRetries: Number(process.env.MODEL_MAX_RETRIES ?? 4), temperature: 0.4 });
  }
  return spec;
}

export type ModelProvider = "anthropic" | "openai" | "google-genai";

/** Model configuration entered by the user in the web interface. The key is only kept in memory. */
export interface RuntimeModelSettings {
  provider: ModelProvider;
  model: string;
  apiKey: string;
  /** Optional OpenAI-compatible base URL (vLLM, OpenRouter, Azure gateway…). */
  baseUrl?: string;
}

export const MODEL_PROVIDERS: { id: ModelProvider; label: string; defaultModel: string }[] = [
  { id: "anthropic", label: "Anthropic", defaultModel: "claude-sonnet-4-6" },
  { id: "openai", label: "OpenAI / compatible", defaultModel: "gpt-4.1" },
  { id: "google-genai", label: "Google Gemini", defaultModel: "gemini-2.5-flash" },
];

/** Build a model instance from settings pasted in the UI. Throws a user-readable error on invalid input. */
export function createChatModelFromSettings(settings: RuntimeModelSettings): any {
  const provider = settings?.provider;
  const model = String(settings?.model ?? "").trim();
  const apiKey = String(settings?.apiKey ?? "").trim();
  const baseUrl = String(settings?.baseUrl ?? "").trim();
  if (!MODEL_PROVIDERS.some((p) => p.id === provider)) throw new Error("Unknown model provider");
  if (!model) throw new Error("Model name is required");
  if (!apiKey) throw new Error("API key is required");
  if (baseUrl && !/^https?:\/\//i.test(baseUrl)) throw new Error("Base URL must start with http:// or https://");
  const maxRetries = Number(process.env.MODEL_MAX_RETRIES ?? 4);
  switch (provider) {
    case "anthropic":
      return new ChatAnthropic({ model, apiKey, maxRetries, temperature: 0.4 });
    case "openai":
      return new ChatOpenAI({
        model,
        apiKey,
        maxRetries,
        temperature: 0.4,
        ...(baseUrl ? { configuration: { baseURL: baseUrl } } : {}),
      });
    case "google-genai":
      return new GeminiToolCompatibleChat({ model, apiKey, maxRetries, temperature: 0.4 });
  }
}
