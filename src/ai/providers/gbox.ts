import { spawn } from "bun";
import { join } from "path";
import { homedir } from "node:os";
import { unlink } from "node:fs/promises";
import type { AIProvider, AIRequest } from "../types";

export class GboxProvider implements AIProvider {
  name = "gbox";

  async generateJSON<T>(request: AIRequest): Promise<T> {
    const schemaPath = join("/tmp", `mcp-schema-${Date.now()}.json`);
    if (request.schema) {
      await Bun.write(schemaPath, JSON.stringify(request.schema));
    }

    try {
      const args = ["gbox", "--high", "--json"];
      if (request.schema) args.push("--schema", schemaPath);
      args.push("--prompt", request.prompt);

      const proc = spawn(args, {
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, CALIBRE_CONFIG_DIRECTORY: join(homedir(), ".calibre-mcp-empty") }
      });

      const output = await new Response(proc.stdout).text();
      await proc.exited;
      
      let result = JSON.parse(output.trim());
      if (result.error && result.raw && typeof result.raw === "string") {
        try {
          const rawParsed = JSON.parse(result.raw);
          // If we requested a specific schema and the raw output matches it, return that
          if (rawParsed.toc || rawParsed.tags || rawParsed.title) {
            result = rawParsed;
          }
        } catch (e) {}
      }
      return result as T;
    } finally {
      if (request.schema) await unlink(schemaPath).catch(() => {});
    }
  }

  async generateText(request: AIRequest): Promise<string> {
    const proc = spawn(["gbox", "--high", "--prompt", request.prompt], {
      stdout: "pipe",
      env: { ...process.env, CALIBRE_CONFIG_DIRECTORY: join(homedir(), ".calibre-mcp-empty") }
    });
    const output = await new Response(proc.stdout).text();
    await proc.exited;
    return output.trim();
  }
}
