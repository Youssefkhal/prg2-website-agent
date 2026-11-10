import "reflect-metadata";
import * as fs from "node:fs";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AgentService } from "./agent/agent.service";
import { ApiController } from "./api/api.controller";
import { config } from "./config";
import { RegistryService } from "./registry/registry.service";

@Module({
  controllers: [ApiController],
  providers: [RegistryService, AgentService],
})
class AppModule {}

async function bootstrap() {
  fs.mkdirSync(config.workspaceDir, { recursive: true });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  app.useBodyParser("json", { limit: "40mb" }); // images arrive as base64 data URLs
  // The UI can be served by Nest (same origin) or from GitHub Pages (different origin).
  const extraOrigins = (process.env.CORS_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  app.enableCors({
    origin: (origin, cb) => {
      const ok =
        !origin ||
        /^https:\/\/youssefkhal\.github\.io$/i.test(origin) ||
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin) ||
        extraOrigins.includes(origin);
      cb(null, ok);
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
  });
  app.useStaticAssets(config.publicDir); // web interface
  app.useStaticAssets(config.workspaceDir, { prefix: "/projects/" }); // live preview of generated sites
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`\n  Web interface: http://localhost:${config.port}\n  Model: ${config.model}\n  Colab GPU: ${config.colabUrl || "not configured (placeholder images)"}\n`);
}

void bootstrap();
