import type { ProviderId } from "./config.js";

/**
 * Popular model providers with their endpoint and a sensible default model (docs/12). All but
 * Anthropic speak the OpenAI API, so they run on `openai-compatible` with a `baseUrl`. Used by
 * `banglaclaw init`; the dashboard's Providers page has the same list (apps/dashboard, keep in sync).
 */
export interface ProviderPreset {
  id: string;
  label: string;
  provider: ProviderId;
  /** Absent for OpenAI and Anthropic, whose SDK defaults are used. */
  baseUrl?: string;
  model: string;
  hint: string;
  /** Where to create an API key. */
  keyUrl?: string;
  /** An embeddings model on the same endpoint, for the knowledge base. */
  embeddingModel?: string;
}

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  { id: "openai", label: "OpenAI", provider: "openai-compatible", model: "gpt-4o-mini", hint: "gpt-4o-mini: good Bangla, low cost", keyUrl: "https://platform.openai.com/api-keys", embeddingModel: "text-embedding-3-small" },
  { id: "anthropic", label: "Anthropic Claude", provider: "anthropic", model: "claude-sonnet-5", hint: "strong reasoning and Bangla", keyUrl: "https://console.anthropic.com/settings/keys" },
  { id: "gemini", label: "Google Gemini", provider: "openai-compatible", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/", model: "gemini-2.5-flash", hint: "free tier, good Bangla", keyUrl: "https://aistudio.google.com/apikey", embeddingModel: "gemini-embedding-001" },
  { id: "openrouter", label: "OpenRouter", provider: "openai-compatible", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini", hint: "one key, hundreds of models", keyUrl: "https://openrouter.ai/keys" },
  { id: "groq", label: "Groq", provider: "openai-compatible", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile", hint: "very fast, free tier", keyUrl: "https://console.groq.com/keys" },
  { id: "deepseek", label: "DeepSeek", provider: "openai-compatible", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", hint: "low cost", keyUrl: "https://platform.deepseek.com/api_keys" },
  { id: "mistral", label: "Mistral", provider: "openai-compatible", baseUrl: "https://api.mistral.ai/v1", model: "mistral-small-latest", hint: "European, free tier", keyUrl: "https://console.mistral.ai/api-keys", embeddingModel: "mistral-embed" },
  { id: "together", label: "Together AI", provider: "openai-compatible", baseUrl: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo", hint: "open models, hosted", keyUrl: "https://api.together.ai/settings/api-keys" },
];
