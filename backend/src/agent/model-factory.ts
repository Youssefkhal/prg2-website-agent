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
