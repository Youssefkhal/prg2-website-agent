import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs";
import * as path from "node:path";
import { config } from "./config";

/**
 * Per-request context (which project / conversation the agent is working on).
 * Propagated automatically through every await of the agent run, so tools,
 * middleware and the filesystem backend can find the right project folder
 * without threading it through LangGraph's config.
 */
export interface RunContext {
  threadId: string;
  projectDir: string;
}

export const runContext = new AsyncLocalStorage<RunContext>();

export function sanitizeThreadId(id: string): string {
  const clean = String(id ?? "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!clean) throw new Error("invalid threadId");
  return clean;
}

export function projectDirFor(threadId: string): string {
  const dir = path.join(config.workspaceDir, sanitizeThreadId(threadId));
  fs.mkdirSync(path.join(dir, "site", "assets", "images"), { recursive: true });
  return dir;
}

export function currentContext(): RunContext {
  const ctx = runContext.getStore();
  if (!ctx) throw new Error("No active run context (tool called outside an agent run)");
  return ctx;
}

/** Map a virtual agent path ("/site/x.png") to a real path inside the project, refusing traversal. */
export function resolveVirtual(virtualPath: string): string {
  const { projectDir } = currentContext();
  const v = virtualPath.startsWith("/") ? virtualPath : "/" + virtualPath;
  if (v.includes("..")) throw new Error("Path traversal not allowed");
  const full = path.resolve(projectDir, v.slice(1));
  if (!full.startsWith(path.resolve(projectDir))) throw new Error("Path outside project");
  return full;
}
