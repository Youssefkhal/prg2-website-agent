import * as path from "node:path";
import * as dotenv from "dotenv";

dotenv.config();

const root = path.resolve(__dirname, "..");

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /**
   * Any LangChain "provider:model" string, e.g.
   *   anthropic:claude-sonnet-4-6   (needs ANTHROPIC_API_KEY)
   *   openai:gpt-4.1               (needs OPENAI_API_KEY, optional OPENAI_BASE_URL)
   *   google-genai:gemini-flash-latest (needs GOOGLE_API_KEY — free tier, no card)
   * If MODEL is empty, the first provider with a key is used.
   * The model must accept images (multimodal) and support tool calling.
   */
  model:
    process.env.MODEL ||
    (process.env.ANTHROPIC_API_KEY
      ? "anthropic:claude-sonnet-4-6"
      : process.env.GOOGLE_API_KEY
        ? "google-genai:gemini-flash-latest"
        : process.env.OPENAI_API_KEY
          ? "openai:gpt-4.1"
          : "anthropic:claude-sonnet-4-6"),
  /** Max model calls per minute across all agents (0 = unlimited). Set ~8 for the Gemini free tier. */
  modelRpm: Number(process.env.MODEL_RPM ?? 0),
  /** Optional cheaper/faster model for the sub-agents. */
  subagentModel: process.env.SUBAGENT_MODEL || undefined,
  colabUrl: (process.env.COLAB_GPU_URL ?? "").replace(/\/+$/, ""),
  colabToken: process.env.COLAB_GPU_TOKEN ?? "",
  rootDir: root,
  skillsDir: path.resolve(root, process.env.SKILLS_DIR ?? "skills"),
  toolsDir: path.resolve(root, process.env.TOOLS_DIR ?? "tools"),
  workspaceDir: path.resolve(root, process.env.WORKSPACE_DIR ?? "workspace"),
  cacheDir: path.resolve(root, ".cache"),
  publicDir: path.resolve(root, "public"),
  /** How many skills are suggested automatically to the model each turn. */
  autoSuggestSkills: Number(process.env.AUTO_SUGGEST_SKILLS ?? 4),
  recursionLimit: Number(process.env.RECURSION_LIMIT ?? 400),
};

export type AppConfig = typeof config;
