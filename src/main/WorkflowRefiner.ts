import log from "electron-log";
import { z } from "zod";
import { generateObject } from "ai";
import { LLMClient } from "./LLMClient";
import { PatternManager } from "./PatternManager";

/**
 * Workflow type classification
 */
type WorkflowType = "form-fill" | "copy-paste" | "navigation" | "unknown";

/**
 * Message in conversation history
 */
interface ConversationMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Conversation state for a refinement session
 */
interface RefinementConversationState {
  conversationId: string;
  automationId: string;
  automationName: string;
  workflowType: WorkflowType;
  originalWorkflow: Record<string, unknown>;
  messages: ConversationMessage[]; // Full conversation history
  modifiedWorkflow?: Record<string, unknown>; // Set when conversation completes
  status: "in-progress" | "completed" | "failed";
  createdAt: number;
}

/**
 * WorkflowRefiner - Service for conversational workflow customization
 *
 * Fully AI-driven conversation - no hardcoded questions.
 * The LLM decides what to ask based on conversation history.
 *
 * Story 1.17: Conversational Workflow Refinement
 */
export class WorkflowRefiner {
  private llmClient: LLMClient;
  private patternManager: PatternManager;
  private conversations: Map<string, RefinementConversationState> = new Map();
  private readonly conversationTTL = 10 * 60 * 1000; // 10 minutes
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(llmClient: LLMClient, patternManager: PatternManager) {
    this.llmClient = llmClient;
    this.patternManager = patternManager;
    this.startCleanupTimer();
  }

  /**
   * Start a new refinement conversation for an automation
   */
  async startRefinementConversation(automationId: string): Promise<{
    conversationId: string;
    greeting: string;
    firstQuestion: string;
    workflow: Record<string, unknown>;
  }> {
    try {
      log.info("[WorkflowRefiner] Starting refinement conversation", {
        automationId,
      });

      // Load automation from database
      const automation = await this.patternManager.getAutomation(automationId);
      if (!automation) {
        throw new Error(`Automation ${automationId} not found`);
      }

      // Parse workflow data - prioritize pattern_data (original workflow)
      let workflowData: Record<string, unknown> = {};
      try {
        const sourceData = automation.pattern_data || automation.workflow;
        if (sourceData) {
          workflowData =
            typeof sourceData === "string"
              ? JSON.parse(sourceData)
              : sourceData;
        }
      } catch (error) {
        log.error("[WorkflowRefiner] Failed to parse workflow data", error);
        workflowData = {};
      }

      // Detect workflow type
      const workflowType = this.detectWorkflowType(workflowData);

      // Create conversation state
      const conversationId = `refine-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const state: RefinementConversationState = {
        conversationId,
        automationId,
        automationName: automation.name,
        workflowType,
        originalWorkflow: workflowData,
        messages: [],
        status: "in-progress",
        createdAt: Date.now(),
      };

      this.conversations.set(conversationId, state);

      // Generate greeting (simple, not AI-generated to save time)
      const greeting = `I can help refine your "${automation.name}" workflow. What would you like to customize?`;

      // First question is simple and contextual to workflow type
      const firstQuestion = this.getInitialQuestion(workflowType);

      // Add greeting + first question to conversation history
      state.messages.push({
        role: "assistant",
        content: `${greeting}\n\n${firstQuestion}`,
      });

      log.info("[WorkflowRefiner] Conversation started", {
        conversationId,
        workflowType,
      });

      return {
        conversationId,
        greeting,
        firstQuestion,
        workflow: workflowData,
      };
    } catch (error) {
      log.error("[WorkflowRefiner] Failed to start refinement", error);
      throw error;
    }
  }

  /**
   * Process user message - lightweight conversation, finalize only when requested
   */
  async sendMessage(
    conversationId: string,
    userMessage: string,
  ): Promise<{
    aiResponse: string;
    isComplete: boolean;
    customizations?: Record<string, unknown>;
    originalWorkflow?: Record<string, unknown>;
  }> {
    const state = this.conversations.get(conversationId);
    if (!state) {
      throw new Error("Conversation not found or expired");
    }

    try {
      log.info("[WorkflowRefiner] Processing message", {
        conversationId,
        messageLength: userMessage.length,
        exchangeCount: Math.floor(state.messages.length / 2),
      });

      // Add user message to conversation history
      state.messages.push({
        role: "user",
        content: userMessage,
      });

      // Check if user explicitly wants to finalize with keywords
      const userWantsToFinalize =
        /\b(done|that's it|finish|finalize|save|ready)\b/i.test(userMessage);

      // Get AI response and check if AI thinks it has enough info
      const chatResult = await this.generateChatResponse(state);

      if (userWantsToFinalize || chatResult.shouldFinalize) {
        // Generate final modified workflow
        log.info("[WorkflowRefiner] Finalizing conversation...", {
          reason: userWantsToFinalize ? "user keyword" : "AI decision",
        });
        const modifiedWorkflow = await this.generateModifiedWorkflow(state);

        state.status = "completed";
        state.modifiedWorkflow = modifiedWorkflow;

        const aiResponse = chatResult.shouldFinalize
          ? chatResult.response // Use AI's natural response
          : "Perfect! I've updated your workflow based on our conversation. Review the changes below and click 'Save' when ready.";

        state.messages.push({
          role: "assistant",
          content: aiResponse,
        });

        return {
          aiResponse,
          isComplete: true,
          customizations: modifiedWorkflow,
          originalWorkflow: state.originalWorkflow,
        };
      } else {
        // Continue conversation
        state.messages.push({
          role: "assistant",
          content: chatResult.response,
        });

        return {
          aiResponse: chatResult.response,
          isComplete: false,
        };
      }
    } catch (error) {
      log.error("[WorkflowRefiner] Failed to process message", error);
      throw error;
    }
  }

  /**
   * Generate conversational AI response (lightweight, fast)
   * Returns response and whether AI has enough info to finalize
   */
  private async generateChatResponse(
    state: RefinementConversationState,
  ): Promise<{ response: string; shouldFinalize: boolean }> {
    // Build workflow summary (lightweight)
    const workflow = state.originalWorkflow;
    const workflowSummary = this.summarizeWorkflow(workflow);

    // Use simple text completion for conversation
    const recentMessages = state.messages.slice(-4); // Only last 2 exchanges
    const conversationContext = recentMessages
      .map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.content}`)
      .join("\n");

    const prompt = `You are helping a user refine their "${state.automationName}" workflow.

Current workflow: ${workflowSummary}

Recent conversation:
${conversationContext}

Task: Decide if you have ENOUGH information to modify the workflow, or if you need to ask more questions.

Respond in this format:
READY: yes/no
RESPONSE: [Your conversational response]

If READY=yes: Tell the user you'll finalize the changes (e.g., "Got it! I have everything I need. Let me update your workflow...")
If READY=no: Ask ONE specific follow-up question to clarify their needs.

Be brief and helpful.`;

    log.info("[WorkflowRefiner] Generating chat response...");

    const response = await this.llmClient.completeText(prompt, {
      /**
       * Temperature: 0.7 (Conversational - User Interaction)
       * Rationale: Higher temperature for natural, engaging conversation with users
       * during workflow refinement. We want varied, helpful responses that feel
       * conversational, not robotic. Lower values would make the AI too rigid.
       */
      temperature: 0.7,
    });

    log.info("[WorkflowRefiner] Chat response generated");

    // Parse response
    const readyMatch = response.match(/READY:\s*(yes|no)/i);
    const responseMatch = response.match(/RESPONSE:\s*([\s\S]+)/i);

    const shouldFinalize = readyMatch?.[1]?.toLowerCase() === "yes" || false;
    const aiResponse = responseMatch?.[1]?.trim() || response.trim();

    log.info("[WorkflowRefiner] AI decision", {
      shouldFinalize,
      responseLength: aiResponse.length,
    });

    return {
      response: aiResponse,
      shouldFinalize,
    };
  }

  /**
   * Create lightweight workflow summary for conversation context
   */
  private summarizeWorkflow(workflow: Record<string, unknown>): string {
    if (Array.isArray(workflow.steps) && workflow.steps.length > 0) {
      const steps = workflow.steps.slice(0, 5); // First 5 steps
      const stepList = steps
        .map(
          (s: Record<string, unknown>, i: number) =>
            `${i + 1}. ${String(s.action || "Unknown")}${s.target ? ` (${String(s.target).substring(0, 30)})` : ""}`,
        )
        .join(", ");
      const more =
        workflow.steps.length > 5
          ? ` + ${workflow.steps.length - 5} more steps`
          : "";
      return `${stepList}${more}`;
    }
    return "Custom workflow";
  }

  /**
   * Generate final modified workflow based on conversation (called only once at end)
   */
  private async generateModifiedWorkflow(
    state: RefinementConversationState,
  ): Promise<Record<string, unknown>> {
    const conversationSummary = state.messages
      .filter((m) => m.role === "user")
      .map((m) => m.content)
      .join(" | ");

    const workflowJson = JSON.stringify(state.originalWorkflow, null, 2);

    const prompt = `Modify this workflow based on the user's requests.

Original workflow:
${workflowJson}

User's requests from conversation:
${conversationSummary}

Return the COMPLETE modified workflow with all steps (unchanged + new ones).
Be specific: include full URLs, search terms, selectors, values.`;

    const schema = z.object({
      steps: z.array(
        z.object({
          action: z.string(),
          target: z.string().optional(),
          value: z.string().optional(),
          url: z.string().optional(),
          tab: z.number().optional(),
        }),
      ),
    });

    log.info("[WorkflowRefiner] Generating final modified workflow...");

    const timeoutMs = 45000; // 45 seconds for workflow generation
    const generatePromise = generateObject({
      model: this.llmClient.getModel(),
      schema,
      prompt,
      /**
       * Temperature: 0.3 (Deterministic - Workflow Generation)
       * Rationale: Low temperature for consistent, structured workflow output.
       * We need deterministic JSON with valid selectors and actions. Higher
       * temperature could introduce variance in workflow structure or invalid
       * CSS selectors, breaking execution reliability.
       */
      temperature: 0.3,
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(
        () => reject(new Error("Workflow generation timeout after 45s")),
        timeoutMs,
      );
    });

    const { object } = (await Promise.race([
      generatePromise,
      timeoutPromise,
    ])) as Awaited<typeof generatePromise>;

    log.info("[WorkflowRefiner] Modified workflow generated:", {
      stepCount: object.steps.length,
    });

    return object;
  }

  /**
   * Save refined workflow to database
   */
  async saveRefinedWorkflow(conversationId: string): Promise<void> {
    const state = this.conversations.get(conversationId);
    if (!state || state.status !== "completed") {
      throw new Error("Conversation not complete or not found");
    }

    if (!state.modifiedWorkflow) {
      throw new Error(
        "No modified workflow available - conversation may not have completed properly",
      );
    }

    try {
      log.info("[WorkflowRefiner] Saving refined workflow", {
        automationId: state.automationId,
        workflowSteps: Array.isArray(state.modifiedWorkflow.steps)
          ? state.modifiedWorkflow.steps.length
          : 0,
      });

      // Save to database
      await this.patternManager.updateAutomationWorkflow(
        state.automationId,
        state.modifiedWorkflow,
      );

      // Cleanup conversation
      this.conversations.delete(conversationId);

      log.info("[WorkflowRefiner] Workflow saved successfully");
    } catch (error) {
      log.error("[WorkflowRefiner] Failed to save refined workflow", error);
      throw error;
    }
  }

  /**
   * Reset conversation to start over
   */
  resetConversation(conversationId: string): void {
    const state = this.conversations.get(conversationId);
    if (state) {
      log.info("[WorkflowRefiner] Resetting conversation", { conversationId });
      // Clear messages except the initial greeting
      const initialGreeting = state.messages[0];
      state.messages = initialGreeting ? [initialGreeting] : [];
      state.status = "in-progress";
    }
  }

  /**
   * Detect workflow type from workflow data structure
   */
  private detectWorkflowType(workflow: Record<string, unknown>): WorkflowType {
    if (!workflow || typeof workflow !== "object") {
      return "unknown";
    }

    // Check for explicit type field
    if (workflow.type && typeof workflow.type === "string") {
      return workflow.type as WorkflowType;
    }

    // Infer from workflow structure
    const steps = workflow.steps || [];
    if (Array.isArray(steps) && steps.length > 0) {
      const hasFormFill = steps.some((s) => {
        if (typeof s !== "object" || !s) return false;
        const step = s as Record<string, unknown>;
        return (
          step.action === "FORM-FILL" ||
          step.action === "FILL_FORM" ||
          step.type === "form"
        );
      });
      const hasCopy = steps.some((s) => {
        if (typeof s !== "object" || !s) return false;
        const step = s as Record<string, unknown>;
        return (
          step.action === "COPY" ||
          step.action === "COPY-PASTE" ||
          step.type === "copy"
        );
      });
      const hasPaste = steps.some((s) => {
        if (typeof s !== "object" || !s) return false;
        const step = s as Record<string, unknown>;
        return step.action === "PASTE" || step.type === "paste";
      });
      const hasCopyPaste = hasCopy && hasPaste;
      const allNavigation = steps.every((s) => {
        if (typeof s !== "object" || !s) return false;
        const step = s as Record<string, unknown>;
        return step.action === "NAVIGATE" || step.type === "navigation";
      });

      if (hasFormFill) return "form-fill";
      if (hasCopyPaste) return "copy-paste";
      if (allNavigation) return "navigation";
    }

    return "unknown";
  }

  /**
   * Get simple initial question based on workflow type
   * (Not AI-generated to save API call and time)
   */
  private getInitialQuestion(workflowType: WorkflowType): string {
    switch (workflowType) {
      case "form-fill":
        return "Would you like me to save credentials, or ask for them each time?";
      case "copy-paste":
        return "Should I keep this workflow specific, or make it work for similar items?";
      case "navigation":
        return "Should this work only on this specific site, or adapt to similar sites?";
      default:
        return "What would you like to customize about this workflow?";
    }
  }

  /**
   * Start cleanup timer to remove expired conversations
   */
  private startCleanupTimer(): void {
    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [id, state] of this.conversations.entries()) {
        if (now - state.createdAt > this.conversationTTL) {
          this.conversations.delete(id);
          log.info("[WorkflowRefiner] Cleaned up expired conversation", { id });
        }
      }
    }, 60000); // Check every minute
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.conversations.clear();
  }
}
