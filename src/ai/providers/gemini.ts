import type { AIProvider, AIRequest } from "../types";

export class GeminiProvider implements AIProvider {
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
    if (data.error) throw new Error(`Gemini Error: ${data.error.message}`);
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
    if (data.error) throw new Error(`Gemini Error: ${data.error.message}`);
    return data.candidates[0].content.parts[0].text;
  }
}
