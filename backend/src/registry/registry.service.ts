import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { config } from "../config";
import { colab } from "../gpu/colab-client";
import { SkillRegistry } from "../skills/skill-registry";
import { ToolRegistry } from "../tools/tool-registry";

/** Holds the skill library and the dynamic tool registry (both hot-reloadable). */
@Injectable()
export class RegistryService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger("Registry");
  readonly skills = new SkillRegistry(config.skillsDir, config.cacheDir, colab);
  readonly tools = new ToolRegistry(config.toolsDir);

  onModuleInit(): void {
    this.skills.load();
    this.skills.watch(() => this.log.log(`skills reloaded: ${this.skills.size}`));
    this.tools.loadManifests();
    this.log.log(`${this.skills.size} skills indexed, ${this.tools.list().length} dynamic tools registered`);
    // Semantic index is computed on the Colab GPU in the background (BM25 works meanwhile).
    void this.skills.indexSemantic().then((r) => {
      if (r.ready) this.log.log(`semantic skill index ready (Colab GPU, ${r.embedded} new embeddings)`);
    });
  }

  onModuleDestroy(): void {
    this.skills.close();
  }
}
