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
