import type { AIProvider, ProviderType } from "./types";
import { GboxProvider } from "./providers/gbox";
import { OpenAIProvider } from "./providers/openai";
import { AnthropicProvider } from "./providers/anthropic";
import { GeminiProvider } from "./providers/gemini";

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
        console.error(`Unknown AI provider type: ${type}, falling back to gbox`);
        return new GboxProvider();
    }
  }
}
