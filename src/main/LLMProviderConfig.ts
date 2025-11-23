import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import type { LanguageModel } from "ai";
import log from "electron-log";

/**
 * LLM Provider type
 */
export type LLMProvider = "openai" | "anthropic" | "gemini";

/**
 * Default models per provider (AC-4: Centralized configuration)
 * Updated to use Gemini 2.5 Flash (not 1.5)
 */
export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o-mini",
  anthropic: "claude-3-5-haiku-20241022", // Haiku for speed/cost
  gemini: "gemini-2.0-flash-exp", // Gemini 2.0 Flash (experimental, faster than 1.5)
};

/**
 * Default vision-capable models for automation execution (AC-4)
 * These models support both text and image inputs
 */
export const DEFAULT_VISION_MODELS: Record<LLMProvider, string> = {
  openai: "gpt-4o", // Vision-capable
  anthropic: "claude-3-5-sonnet-20241022", // Vision-capable
  gemini: "gemini-1.5-pro", // Vision-capable (using Pro for better accuracy)
};

/**
 * LLMProviderConfig - Centralized LLM provider configuration utility
 * Story 1.22 - AC-4: Eliminates ~100 lines of duplicated code across LLM services
 *
 * Features:
 * - Single source of truth for provider detection, API keys, and model defaults
 * - Consistent model selection across all LLM services
 * - Centralized API key management with Gemini env var handling
 */
export class LLMProviderConfig {
  private provider: LLMProvider;
  private modelName: string;
  private useVisionModel: boolean;

  /**
   * Create a new LLM provider config
   * @param useVisionModel - If true, use vision-capable models (for LLMExecutionEngine)
   */
  constructor(useVisionModel: boolean = false) {
    this.provider = this.detectProvider();
    this.useVisionModel = useVisionModel;
    this.modelName = this.selectModel();

    log.info(
      `[LLMProviderConfig] Initialized with provider: ${this.provider}, model: ${this.modelName}`,
    );
  }

  /**
   * Detect provider from environment variable
   * Falls back to OpenAI if not specified
   */
  private detectProvider(): LLMProvider {
    const provider = process.env.LLM_PROVIDER?.toLowerCase();
    if (provider === "anthropic") return "anthropic";
    if (provider === "gemini") return "gemini";
    return "openai"; // Default to OpenAI
  }

  /**
   * Select model name from environment or use defaults
   */
  private selectModel(): string {
    const envModel = process.env.LLM_MODEL;
    if (envModel) return envModel;

    // Use vision models or standard models based on constructor flag
    const defaults = this.useVisionModel
      ? DEFAULT_VISION_MODELS
      : DEFAULT_MODELS;
    return defaults[this.provider];
  }

  /**
   * Get API key for the configured provider
   */
  public getApiKey(): string | undefined {
    switch (this.provider) {
      case "anthropic":
        return process.env.ANTHROPIC_API_KEY;
      case "gemini":
        return process.env.GEMINI_API_KEY;
      case "openai":
        return process.env.OPENAI_API_KEY;
      default:
        return undefined;
    }
  }

  /**
   * Get the configured provider
   */
  public getProvider(): LLMProvider {
    return this.provider;
  }

  /**
   * Get the configured model name
   */
  public getModel(): string {
    return this.modelName;
  }

  /**
   * Initialize language model for the configured provider
   * Handles Gemini API key environment variable setup
   *
   * @returns LanguageModel instance or null if API key missing
   */
  public initializeModel(): LanguageModel | null {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      log.error(
        `[LLMProviderConfig] API key not found for provider: ${this.provider}`,
      );
      return null;
    }

    // Set Gemini API key as environment variable (required by @ai-sdk/google)
    if (this.provider === "gemini") {
      process.env.GOOGLE_GENERATIVE_AI_API_KEY = apiKey;
    }

    // Initialize model based on provider
    switch (this.provider) {
      case "anthropic":
        return anthropic(this.modelName);
      case "gemini":
        return google(this.modelName);
      case "openai":
        return openai(this.modelName);
      default:
        return null;
    }
  }
}
