export interface AIRequest {
  prompt: string;
  systemPrompt?: string;
  schema?: any;
  maxTokens?: number;
}

export interface AIProvider {
  name: string;
  generateJSON<T>(request: AIRequest): Promise<T>;
  generateText(request: AIRequest): Promise<string>;
}

export type ProviderType = "gbox" | "openai" | "anthropic" | "gemini" | "ollama";

export class AIFactory {
  static getProvider(): AIProvider {
    const type = (process.env.AI_PROVIDER || "gbox") as ProviderType;
    
    switch (type) {
      case "gbox":
        return new GboxProvider();
      case "openai":
      case "ollama":
        return new OpenAIProvider(type);
      case "anthropic":
        return new AnthropicProvider();
      case "gemini":
        return new GeminiProvider();
      default:
        return new GboxProvider();
    }
  }
}

// Placeholder for Gbox implementation (to be moved from tools)
import { spawn } from "bun";
import { join } from "path";
import { homedir } from "node:os";
import { unlink } from "node:fs/promises";

class GboxProvider implements AIProvider {
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
          result = JSON.parse(result.raw);
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

class OpenAIProvider implements AIProvider {
  name: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(type: "openai" | "ollama") {
    this.name = type;
    this.apiKey = process.env.OPENAI_API_KEY || "no-key";
    this.baseUrl = type === "ollama" 
      ? (process.env.OLLAMA_BASE_URL || "http://localhost:11434/v1")
      : (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");
    this.model = process.env.AI_MODEL || (type === "ollama" ? "llama3" : "gpt-4o-mini");
  }

  async generateJSON<T>(request: AIRequest): Promise<T> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: "system", content: "You are a helpful assistant that always returns valid JSON." },
          { role: "user", content: request.prompt }
        ],
        response_format: { type: "json_object" }
      })
    });

    const data = await response.json() as any;
    return JSON.parse(data.choices[0].message.content) as T;
  }

  async generateText(request: AIRequest): Promise<string> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: "user", content: request.prompt }]
      })
    });

    const data = await response.json() as any;
    return data.choices[0].message.content;
  }
}

class AnthropicProvider implements AIProvider {
  name = "anthropic";
  async generateJSON<T>(request: AIRequest): Promise<T> {
    // Basic fetch implementation for Anthropic
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "claude-3-5-sonnet-20240620",
        max_tokens: 4096,
        messages: [{ role: "user", content: request.prompt + "\n\nReturn ONLY a JSON object." }]
      })
    });
    const data = await response.json() as any;
    const content = data.content[0].text;
    return JSON.parse(content.substring(content.indexOf("{"), content.lastIndexOf("}") + 1)) as T;
  }
  async generateText(request: AIRequest): Promise<string> {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY || "",
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || "claude-3-5-sonnet-20240620",
        max_tokens: 4096,
        messages: [{ role: "user", content: request.prompt }]
      })
    });
    const data = await response.json() as any;
    return data.content[0].text;
  }
}

class GeminiProvider implements AIProvider {
  name = "gemini";
  async generateJSON<T>(request: AIRequest): Promise<T> {
    const key = process.env.GEMINI_API_KEY || "";
    const model = process.env.AI_MODEL || "gemini-1.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: request.prompt + "\n\nReturn ONLY a valid JSON object matching the requested schema." }] }],
        generationConfig: { responseMimeType: "application/json" }
      })
    });
    const data = await response.json() as any;
    return JSON.parse(data.candidates[0].content.parts[0].text) as T;
  }
  async generateText(request: AIRequest): Promise<string> {
    const key = process.env.GEMINI_API_KEY || "";
    const model = process.env.AI_MODEL || "gemini-1.5-flash";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: request.prompt }] }]
      })
    });
    const data = await response.json() as any;
    return data.candidates[0].content.parts[0].text;
  }
}
