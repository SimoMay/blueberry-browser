import { WebContents } from "electron";
import log from "electron-log";
import {
  streamText,
  generateText,
  type LanguageModel,
  type CoreMessage,
} from "ai";
import * as dotenv from "dotenv";
import { join } from "path";
import type { Window } from "./Window";
import { LLMProviderConfig } from "./LLMProviderConfig";

// Load environment variables from .env file
dotenv.config({ path: join(__dirname, "../../.env") });

interface ChatRequest {
  message: string;
  messageId: string;
}

interface StreamChunk {
  content: string;
  isComplete: boolean;
}

const MAX_CONTEXT_LENGTH = 4000;

/**
 * Temperature: 0.7 (Conversational)
 * Rationale: Higher temperature (0.7) allows for more natural, varied, and creative
 * responses in chat interactions. This is appropriate for user-facing conversations
 * where we want the AI to be helpful, engaging, and adaptable to different question styles.
 * Lower values would make responses too mechanical and repetitive.
 */
const DEFAULT_TEMPERATURE = 0.7;

/**
 * LLMClient - Multi-provider AI client for chat and content generation
 *
 * Features:
 * - Multi-provider support: OpenAI (gpt-4o-mini), Anthropic (Claude Sonnet 4.5), Gemini (Flash 1.5)
 * - Streaming chat responses with real-time sidebar updates
 * - Screenshot and page context injection for multimodal conversations
 * - Message history management for contextual conversations
 * - Temperature: 0.7 for natural, engaging conversational responses
 *
 * Architecture:
 * - Uses Vercel AI SDK (generateText, streamText) for provider abstraction
 * - Injects active tab screenshot as first image in multimodal requests
 * - Truncates page text to 4000 chars to balance context and token cost
 * - Streams responses token-by-token to sidebar for responsive UX
 */
export class LLMClient {
  private readonly webContents: WebContents;
  private window: Window | null = null;
  private readonly config: LLMProviderConfig;
  private readonly model: LanguageModel | null;
  private messages: CoreMessage[] = [];

  constructor(webContents: WebContents) {
    this.webContents = webContents;
    // AC-4: Use centralized LLMProviderConfig instead of duplicated code
    this.config = new LLMProviderConfig(false); // Use standard models for chat
    this.model = this.config.initializeModel();

    this.logInitializationStatus();
  }

  // Set the window reference after construction to avoid circular dependencies
  setWindow(window: Window): void {
    this.window = window;
  }

  // Get the model instance for direct use with AI SDK functions
  getModel(): LanguageModel {
    if (!this.model) {
      throw new Error(
        "LLM model not initialized - check API key configuration",
      );
    }
    return this.model;
  }

  private logInitializationStatus(): void {
    if (this.model) {
      log.info(
        `✅ LLM Client initialized with ${this.config.getProvider()} provider using model: ${this.config.getModel()}`,
      );
    } else {
      const keyName =
        this.config.getProvider() === "anthropic"
          ? "ANTHROPIC_API_KEY"
          : this.config.getProvider() === "gemini"
            ? "GEMINI_API_KEY"
            : "OPENAI_API_KEY";
      log.error(
        `❌ LLM Client initialization failed: ${keyName} not found in environment variables.\n` +
          `Please add your API key to the .env file in the project root.`,
      );
    }
  }

  // AC-4: Removed getProvider(), getModelName(), initializeModel(), getApiKey() methods - now handled by LLMProviderConfig

  async sendChatMessage(request: ChatRequest): Promise<void> {
    try {
      // Get screenshot from active tab if available
      let screenshot: string | null = null;
      if (this.window) {
        const activeTab = this.window.activeTab;
        if (activeTab) {
          try {
            const image = await activeTab.screenshot();
            screenshot = image.toDataURL();
          } catch (error) {
            log.error("Failed to capture screenshot:", error);
          }
        }
      }

      // Build user message content with screenshot first, then text
      const userContent: Array<
        { type: "image"; image: string } | { type: "text"; text: string }
      > = [];

      // Add screenshot as the first part if available
      if (screenshot) {
        userContent.push({
          type: "image",
          image: screenshot,
        });
      }

      // Add text content
      userContent.push({
        type: "text",
        text: request.message,
      });

      // Create user message in CoreMessage format
      const userMessage: CoreMessage = {
        role: "user",
        content: userContent.length === 1 ? request.message : userContent,
      };

      this.messages.push(userMessage);

      // Send updated messages to renderer
      this.sendMessagesToRenderer();

      if (!this.model) {
        this.sendErrorMessage(
          request.messageId,
          "LLM service is not configured. Please add your API key to the .env file.",
        );
        return;
      }

      const messages = await this.prepareMessagesWithContext();
      await this.streamResponse(messages, request.messageId);
    } catch (error) {
      log.error("Error in LLM request:", error);
      this.handleStreamError(error, request.messageId);
    }
  }

  clearMessages(): void {
    this.messages = [];
    this.sendMessagesToRenderer();
  }

  getMessages(): CoreMessage[] {
    return this.messages;
  }

  private sendMessagesToRenderer(): void {
    this.webContents.send("chat-messages-updated", this.messages);
  }

  private async prepareMessagesWithContext(): Promise<CoreMessage[]> {
    // Get page context from active tab
    let pageUrl: string | null = null;
    let pageText: string | null = null;

    if (this.window) {
      const activeTab = this.window.activeTab;
      if (activeTab) {
        pageUrl = activeTab.url;
        try {
          pageText = await activeTab.getTabText();
        } catch (error) {
          log.error("Failed to get page text:", error);
        }
      }
    }

    // Build system message
    const systemMessage: CoreMessage = {
      role: "system",
      content: this.buildSystemPrompt(pageUrl, pageText),
    };

    // Include all messages in history (system + conversation)
    return [systemMessage, ...this.messages];
  }

  private buildSystemPrompt(
    url: string | null,
    pageText: string | null,
  ): string {
    const parts: string[] = [
      "You are a helpful AI assistant integrated into a web browser.",
      "You can analyze and discuss web pages with the user.",
      "The user's messages may include screenshots of the current page as the first image.",
    ];

    if (url) {
      parts.push(`\nCurrent page URL: ${url}`);
    }

    if (pageText) {
      const truncatedText = this.truncateText(pageText, MAX_CONTEXT_LENGTH);
      parts.push(`\nPage content (text):\n${truncatedText}`);
    }

    parts.push(
      "\nPlease provide helpful, accurate, and contextual responses about the current webpage.",
      "If the user asks about specific content, refer to the page content and/or screenshot provided.",
    );

    return parts.join("\n");
  }

  private truncateText(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  }

  private async streamResponse(
    messages: CoreMessage[],
    messageId: string,
  ): Promise<void> {
    if (!this.model) {
      throw new Error("Model not initialized");
    }

    const result = await streamText({
      model: this.model,
      messages,
      temperature: DEFAULT_TEMPERATURE, // 0.7 for natural conversational responses
      maxRetries: 3,
      abortSignal: undefined, // Could add abort controller for cancellation
    });

    await this.processStream(result.textStream, messageId);
  }

  private async processStream(
    textStream: AsyncIterable<string>,
    messageId: string,
  ): Promise<void> {
    let accumulatedText = "";

    // Create a placeholder assistant message
    const assistantMessage: CoreMessage = {
      role: "assistant",
      content: "",
    };

    // Keep track of the index for updates
    const messageIndex = this.messages.length;
    this.messages.push(assistantMessage);

    for await (const chunk of textStream) {
      accumulatedText += chunk;

      // Update assistant message content
      this.messages[messageIndex] = {
        role: "assistant",
        content: accumulatedText,
      };
      this.sendMessagesToRenderer();

      this.sendStreamChunk(messageId, {
        content: chunk,
        isComplete: false,
      });
    }

    // Final update with complete content
    this.messages[messageIndex] = {
      role: "assistant",
      content: accumulatedText,
    };
    this.sendMessagesToRenderer();

    // Send the final complete signal
    this.sendStreamChunk(messageId, {
      content: accumulatedText,
      isComplete: true,
    });
  }

  private handleStreamError(error: unknown, messageId: string): void {
    log.error("Error streaming from LLM:", error);

    const errorMessage = this.getErrorMessage(error);
    this.sendErrorMessage(messageId, errorMessage);
  }

  private getErrorMessage(error: unknown): string {
    if (!(error instanceof Error)) {
      return "An unexpected error occurred. Please try again.";
    }

    const message = error.message.toLowerCase();

    if (message.includes("401") || message.includes("unauthorized")) {
      return "Authentication error: Please check your API key in the .env file.";
    }

    if (message.includes("429") || message.includes("rate limit")) {
      return "Rate limit exceeded. Please try again in a few moments.";
    }

    if (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("econnrefused")
    ) {
      return "Network error: Please check your internet connection.";
    }

    if (message.includes("timeout")) {
      return "Request timeout: The service took too long to respond. Please try again.";
    }

    return "Sorry, I encountered an error while processing your request. Please try again.";
  }

  private sendErrorMessage(messageId: string, errorMessage: string): void {
    this.sendStreamChunk(messageId, {
      content: errorMessage,
      isComplete: true,
    });
  }

  private sendStreamChunk(messageId: string, chunk: StreamChunk): void {
    this.webContents.send("chat-response", {
      messageId,
      content: chunk.content,
      isComplete: chunk.isComplete,
    });
  }

  /**
   * Complete text (non-streaming) for structured responses
   * Used by WorkflowRefiner for parsing user responses
   *
   * @param prompt - The prompt to send to the LLM
   * @param options - Generation options
   * @returns The complete text response
   */
  async completeText(
    prompt: string,
    options?: {
      temperature?: number;
      jsonMode?: boolean;
    },
  ): Promise<string> {
    if (!this.model) {
      throw new Error("LLM model not initialized");
    }

    const messages: CoreMessage[] = [
      {
        role: "user",
        content: prompt,
      },
    ];

    const result = await generateText({
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.7, // Default 0.7 for conversational, can override for structured tasks
      maxRetries: 3,
    });

    return result.text;
  }
}
