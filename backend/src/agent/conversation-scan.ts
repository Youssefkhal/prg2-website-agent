/* Pure helpers (no LangChain import) — derive dynamic context from the message history. */

const msgType = (m: any): string => m?.type ?? m?._getType?.() ?? "";

export function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b: any) => (typeof b === "string" ? b : b?.type === "text" ? b.text : ""))
      .filter(Boolean)
      .join("\n");
  return "";
}

/** Skills loaded and tools enabled so far, derived from the conversation itself (survives checkpoints). */
export function scanConversation(messages: any[]): { loadedSkills: string[]; enabledTools: string[]; lastUserText: string } {
  const loaded = new Set<string>();
  const enabled = new Set<string>();
  let lastUserText = "";
  for (const m of messages) {
    const t = msgType(m);
    if (t === "human") lastUserText = textOf(m.content);
    if (t === "ai" || t === "AIMessageChunk") {
      for (const tc of m.tool_calls ?? []) {
        if (tc.name === "load_skill" && tc.args?.name && !tc.args?.file) loaded.add(String(tc.args.name));
        if (tc.name === "enable_tools") for (const n of tc.args?.names ?? []) enabled.add(String(n));
      }
    }
  }
  return { loadedSkills: [...loaded], enabledTools: [...enabled], lastUserText };
}

