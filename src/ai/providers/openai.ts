import type { AIProvider, AIRequest } from "../types";

export class OpenAIProvider implements AIProvider {
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
    if (data.error) throw new Error(`OpenAI Error: ${data.error.message}`);
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
    if (data.error) throw new Error(`OpenAI Error: ${data.error.message}`);
    return data.choices[0].message.content;
  }
}
