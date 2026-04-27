import type { AIProvider, AIRequest } from "../types";

export class AnthropicProvider implements AIProvider {
  name = "anthropic";

  async generateJSON<T>(request: AIRequest): Promise<T> {
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
    if (data.error) throw new Error(`Anthropic Error: ${data.error.message}`);
    
    const content = data.content[0].text;
    const jsonStart = content.indexOf("{");
    const jsonEnd = content.lastIndexOf("}") + 1;
    return JSON.parse(content.substring(jsonStart, jsonEnd)) as T;
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
    if (data.error) throw new Error(`Anthropic Error: ${data.error.message}`);
    return data.content[0].text;
  }
}
