import log from "electron-log";
import { v4 as uuidv4 } from "uuid";
import { DatabaseManager } from "./database/Database";
import Database from "better-sqlite3";
import {
  PatternTrackInput,
  PatternGetAllInput,
  SaveAutomationInput,
} from "./schemas/patternSchemas";
import { SaveRecordingInput } from "./schemas/recordingSchemas";
import { IntentSummarizer } from "./IntentSummarizer"; // Story 1.12
import { LLMPatternAnalyzer, type SessionAction } from "./LLMPatternAnalyzer"; // Story 1.15
import { NotificationManager } from "./NotificationManager"; // Story 1.9

/**
 * Pattern type
 */
export type PatternType = "navigation" | "form" | "copy-paste";

/**
 * Pattern interface
 */
export interface Pattern {
  id: string;
  type: PatternType;
  pattern_data: string;
  confidence: number;
  created_at: number;
}

/**
 * Automation interface
 */
export interface Automation {
  id: string;
  pattern_id: string;
  name: string;
  description?: string;
  created_at: number;
}

/**
 * Navigation event data for pattern tracking
 */
export interface NavigationEvent {
  url: string;
  tabId: string;
  timestamp: number;
  eventType: "did-navigate" | "did-navigate-in-page";
  pageTitle?: string; // Enhanced context for AI intent summarization (Story 1.12)
}

/**
 * Navigation sequence item stored in pattern_data
 */
export interface NavigationSequenceItem {
  url: string;
  timestamp: number;
  tabId: string;
  pageTitle?: string; // Enhanced context for AI intent summarization (Story 1.12)
}

/**
 * Navigation pattern structure for JSON storage
 */
export interface NavigationPattern {
  sequence: NavigationSequenceItem[];
  sessionGap: number; // 30 minutes in milliseconds (1800000)
}

/**
 * Form field data for pattern tracking
 */
export interface FormField {
  name: string;
  type: string;
  valuePattern:
    | "email_format"
    | "name_format"
    | "phone_format"
    | "number_format"
    | "text_format";
  label?: string; // Enhanced context for AI intent summarization (Story 1.12)
  sanitizedValue?: string; // Sanitized actual value for non-sensitive fields (Story 1.12 - Code Review fix)
}

/**
 * Form submission data from renderer process
 */
export interface FormSubmissionData {
  domain: string;
  formSelector: string;
  fields: FormField[];
  timestamp: number;
  tabId: string;
}

/**
 * Form pattern structure for JSON storage
 */
export interface FormPattern {
  domain: string;
  formSelector: string;
  fields: FormField[];
}

/**
 * Copy/Paste pair data structure (Story 1.7b)
 */
export interface CopyPastePair {
  copiedText?: string; // Plaintext if not sensitive
  copiedTextHash?: string; // SHA-256 hash if sensitive OR always present
  sourceUrl: string;
  sourceElement: string; // CSS selector
  sourcePageTitle: string;
  destinationUrl: string;
  destinationElement: string; // CSS selector
  destinationPageTitle: string;
  timestamp: number; // Unix timestamp
  timeGap: number; // Milliseconds between copy and paste
}

/**
 * Copy/Paste pattern structure for JSON storage (Story 1.7b)
 */
export interface CopyPastePattern {
  pairs: CopyPastePair[];
}

/**
 * Standard IPC response format
 */
interface IPCResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Copy event tracking (Story 1.7b)
 */
interface CopyEventData {
  text: string;
  textHash: string;
  sourceElement: string;
  url: string;
  pageTitle: string;
  timestamp: number;
  tabId: string;
  isSensitive: boolean;
}

/**
 * PatternManager - Singleton for managing patterns and automations
 * Handles CRUD operations for pattern detection and automation execution
 */
export class PatternManager {
  private static instance: PatternManager | null = null;
  private db: Database.Database | null = null;
  private intentSummarizer: IntentSummarizer | null = null; // Story 1.12
  private llmAnalyzer: LLMPatternAnalyzer | null = null; // Story 1.15
  private notificationManager: NotificationManager | null = null; // Story 1.9
  private recentCopyEvents: CopyEventData[] = []; // Story 1.7b
  private copyEventCleanupInterval: NodeJS.Timeout | null = null; // Story 1.7b
  private sessionActions: SessionAction[] = []; // Story 1.15 - Session tracking for LLM context
  private lastLLMCallTimestamps: Map<string, number> = new Map(); // Story 1.15 - Rate limiting for LLM calls
  private currentExecutionEngine: { cancel: () => void } | null = null; // Story 1.16 - Track current execution for cancellation
  private currentExecutionId: string | null = null; // Story 1.16 - Track automation ID for immediate cancel feedback

  private constructor() {
    // Private constructor for singleton pattern
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): PatternManager {
    if (!PatternManager.instance) {
      PatternManager.instance = new PatternManager();
    }
    return PatternManager.instance;
  }

  /**
   * Initialize the pattern manager
   * Called once at app startup
   */
  public async initialize(): Promise<void> {
    try {
      log.info("[PatternManager] Initializing...");

      // Get database instance
      this.db = DatabaseManager.getInstance().getDatabase();

      // Initialize IntentSummarizer (Story 1.12)
      this.intentSummarizer = IntentSummarizer.getInstance(this.db);

      // Initialize LLMPatternAnalyzer (Story 1.15)
      this.llmAnalyzer = new LLMPatternAnalyzer();

      // Initialize NotificationManager (Story 1.9)
      this.notificationManager = NotificationManager.getInstance();

      // Run cleanup on startup
      await this.cleanupOldPatterns();

      // Start copy event cleanup interval (Story 1.7b)
      this.startCopyEventCleanup();

      log.info("[PatternManager] Initialized successfully");
    } catch (error) {
      log.error("[PatternManager] Initialization failed:", error);
      throw {
        code: "PATTERN_INIT_ERROR",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Track a new pattern
   * Database integration will be implemented in Story 1.6
   */
  public async trackPattern(
    data: PatternTrackInput,
  ): Promise<IPCResponse<Pattern>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Track pattern:", data.type);

      // Placeholder: Database integration will happen in Story 1.6
      const pattern: Pattern = {
        id: uuidv4(),
        type: data.type,
        pattern_data: data.pattern_data,
        confidence: data.confidence,
        created_at: Date.now(),
      };

      log.info("[PatternManager] Pattern tracked successfully:", pattern.id);

      return {
        success: true,
        data: pattern,
      };
    } catch (error) {
      log.error("[PatternManager] Track pattern error:", error);
      return {
        success: false,
        error: {
          code: "TRACK_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Get all patterns (optionally filtered)
   * Story 1.14: Implemented database query for pattern retrieval
   */
  public async getAllPatterns(
    filters?: PatternGetAllInput,
  ): Promise<IPCResponse<Pattern[]>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info(
        "[PatternManager] Get all patterns, filters:",
        filters ? JSON.stringify(filters) : "none",
      );

      // Build query with optional filters
      let query = `
        SELECT id, type, pattern_data, confidence, created_at
        FROM patterns
        WHERE 1=1
      `;
      const params: unknown[] = [];

      if (filters?.type) {
        query += " AND type = ?";
        params.push(filters.type);
      }

      // Order by most recently seen patterns first
      query += " ORDER BY last_seen DESC";

      const stmt = this.db.prepare(query);
      const rows = stmt.all(...params) as Array<{
        id: string;
        type: string;
        pattern_data: string;
        confidence: number;
        created_at: number;
      }>;

      const patterns: Pattern[] = rows.map((row) => ({
        id: row.id,
        type: row.type as PatternType,
        pattern_data: row.pattern_data,
        confidence: row.confidence,
        created_at: row.created_at,
      }));

      log.info("[PatternManager] Retrieved patterns, count:", patterns.length);

      return {
        success: true,
        data: patterns,
      };
    } catch (error) {
      log.error("[PatternManager] Get patterns error:", error);
      return {
        success: false,
        error: {
          code: "QUERY_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Save an automation
   * Database integration will be implemented in Story 1.10
   */
  public async saveAutomation(
    data: SaveAutomationInput,
  ): Promise<IPCResponse<Automation>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Save automation:", data.name);

      // Fetch pattern data to include in automation
      const patternStmt = this.db.prepare(`
        SELECT pattern_data FROM patterns WHERE id = ?
      `);
      const patternRow = patternStmt.get(data.pattern_id) as
        | { pattern_data: string }
        | undefined;

      if (!patternRow) {
        throw new Error(`Pattern not found: ${data.pattern_id}`);
      }

      // Create automation object
      const automation: Automation = {
        id: uuidv4(),
        pattern_id: data.pattern_id,
        name: data.name,
        description: data.description,
        created_at: Date.now(),
      };

      // Insert into database with pattern_data
      const stmt = this.db.prepare(`
        INSERT INTO automations (id, pattern_id, name, description, pattern_data, execution_count, last_executed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        automation.id,
        automation.pattern_id,
        automation.name,
        automation.description || null,
        patternRow.pattern_data,
        0, // execution_count starts at 0
        null, // last_executed is null initially
        automation.created_at,
      );

      log.info(
        "[PatternManager] Automation saved successfully:",
        automation.id,
      );

      return {
        success: true,
        data: automation,
      };
    } catch (error) {
      log.error("[PatternManager] Save automation error:", error);
      return {
        success: false,
        error: {
          code: "SAVE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Dismiss a pattern to prevent future notifications
   */
  public async dismissPattern(
    patternId: string,
  ): Promise<IPCResponse<{ patternId: string }>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Dismissing pattern:", patternId);

      // Update pattern to set dismissed = 1
      const stmt = this.db.prepare(`
        UPDATE patterns
        SET dismissed = 1
        WHERE id = ?
      `);

      const result = stmt.run(patternId);

      if (result.changes === 0) {
        throw new Error("Pattern not found");
      }

      log.info("[PatternManager] Pattern dismissed successfully:", patternId);

      return {
        success: true,
        data: { patternId },
      };
    } catch (error) {
      log.error("[PatternManager] Dismiss pattern error:", error);
      return {
        success: false,
        error: {
          code: "DISMISS_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Get all automations with full details including pattern data and execution stats
   */
  public async getAutomations(): Promise<
    IPCResponse<
      Array<{
        id: string;
        patternId: string;
        name: string;
        description?: string;
        patternData: NavigationPattern | FormPattern;
        patternType: string;
        executionCount: number;
        lastExecuted?: number;
        createdAt: number;
      }>
    >
  > {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Getting all automations");

      const stmt = this.db.prepare(`
        SELECT
          a.id,
          a.pattern_id as patternId,
          a.name,
          a.description,
          a.pattern_data as patternData,
          a.execution_count as executionCount,
          a.last_executed as lastExecuted,
          a.created_at as createdAt,
          p.type as patternType
        FROM automations a
        LEFT JOIN patterns p ON a.pattern_id = p.id
        ORDER BY a.created_at DESC
      `);

      const rows = stmt.all() as Array<{
        id: string;
        patternId: string;
        name: string;
        description?: string;
        patternData: string;
        patternType: string;
        executionCount: number;
        lastExecuted?: number;
        createdAt: number;
      }>;

      // Parse pattern_data JSON for each automation
      const automations = rows.map((row) => ({
        id: row.id,
        patternId: row.patternId,
        name: row.name,
        description: row.description,
        patternData: JSON.parse(row.patternData),
        patternType: row.patternType,
        executionCount: row.executionCount,
        lastExecuted: row.lastExecuted || undefined,
        createdAt: row.createdAt,
      }));

      log.info(`[PatternManager] Retrieved ${automations.length} automations`);

      return {
        success: true,
        data: automations,
      };
    } catch (error) {
      log.error("[PatternManager] Get automations error:", error);
      return {
        success: false,
        error: {
          code: "QUERY_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Edit automation (update name and description)
   */
  public async editAutomation(data: {
    automationId: string;
    name: string;
    description?: string;
  }): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Editing automation:", data.automationId);

      const stmt = this.db.prepare(`
        UPDATE automations
        SET name = ?, description = ?
        WHERE id = ?
      `);

      const result = stmt.run(
        data.name,
        data.description || null,
        data.automationId,
      );

      if (result.changes === 0) {
        throw new Error("Automation not found");
      }

      log.info("[PatternManager] Automation edited successfully");

      return {
        success: true,
      };
    } catch (error) {
      log.error("[PatternManager] Edit automation error:", error);
      return {
        success: false,
        error: {
          code: "UPDATE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Delete automation
   */
  public async deleteAutomation(
    automationId: string,
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Deleting automation:", automationId);

      const stmt = this.db.prepare(`
        DELETE FROM automations WHERE id = ?
      `);

      const result = stmt.run(automationId);

      if (result.changes === 0) {
        throw new Error("Automation not found");
      }

      log.info("[PatternManager] Automation deleted successfully");

      return {
        success: true,
      };
    } catch (error) {
      log.error("[PatternManager] Delete automation error:", error);
      return {
        success: false,
        error: {
          code: "DELETE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Execute an automation using LLMExecutionEngine
   * Story 1.16: LLM-guided execution with page-by-page AI decisions
   * Returns execution result with steps completed and duration
   */
  public async executeAutomation(
    automationId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    _window: any, // Window instance passed from EventManager (circular dependency prevents proper typing)
    onProgress?: (
      step: number,
      total: number,
      description: string,
      screenshotBase64?: string,
    ) => void,
  ): Promise<
    IPCResponse<{ stepsExecuted: number; duration: number; error?: string }>
  > {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Execute automation:", automationId);

      // Fetch automation from database with full details
      // Also fetch pattern data to extract starting URL from original actions
      const stmt = this.db.prepare(`
        SELECT
          a.id,
          a.name,
          a.description,
          a.pattern_data as patternData,
          p.intent_summary as intentSummary,
          p.pattern_data as originalPatternData,
          p.type as patternType
        FROM automations a
        LEFT JOIN patterns p ON a.pattern_id = p.id
        WHERE a.id = ?
      `);

      const automation = stmt.get(automationId) as
        | {
            id: string;
            name: string;
            description?: string;
            patternData: string;
            intentSummary?: string;
            originalPatternData?: string;
            patternType?: string;
          }
        | undefined;

      if (!automation) {
        throw new Error("Automation not found");
      }

      // Parse workflow to extract start URL
      const workflow = JSON.parse(automation.patternData);
      let startUrl: string | null = null;

      // Extract start URL from workflow (check multiple formats)
      if (workflow && typeof workflow === "object") {
        const workflowObj = workflow as Record<string, unknown>;

        // Format 1: workflow.startUrl (top-level field added by Story 1.15)
        if (typeof workflowObj.startUrl === "string") {
          startUrl = workflowObj.startUrl;
        }
        // Format 2: workflow.steps[0].url (Story 1.15 navigation patterns)
        else if (
          Array.isArray(workflowObj.steps) &&
          workflowObj.steps.length > 0
        ) {
          const firstStep = workflowObj.steps[0] as Record<string, unknown>;
          if (typeof firstStep.url === "string") {
            startUrl = firstStep.url;
          }
          // Fallback: Check if any step has a URL (first navigation action)
          else {
            for (const step of workflowObj.steps) {
              const stepObj = step as Record<string, unknown>;
              if (
                typeof stepObj.url === "string" &&
                stepObj.url.startsWith("http")
              ) {
                startUrl = stepObj.url;
                log.info(
                  "[PatternManager] Using URL from first navigation step:",
                  startUrl,
                );
                break;
              }
            }
          }
        }
        // Format 3: workflow.sequence[0].url (Story 1.15 alternative format)
        else if (
          Array.isArray(workflowObj.sequence) &&
          workflowObj.sequence.length > 0
        ) {
          const firstItem = workflowObj.sequence[0] as Record<string, unknown>;
          startUrl = typeof firstItem.url === "string" ? firstItem.url : null;
        }
      }

      // Fallback: Extract URL from original pattern data (navigation/copy-paste actions)
      if (!startUrl && automation.originalPatternData) {
        try {
          const patternData = JSON.parse(automation.originalPatternData);
          log.info("[PatternManager] Parsed original pattern data:", {
            patternType: automation.patternType,
            hasSteps: Array.isArray(patternData.steps),
            stepsCount: Array.isArray(patternData.steps)
              ? patternData.steps.length
              : 0,
            patternDataKeys: Object.keys(patternData),
          });

          // For navigation patterns, extract first navigation URL
          if (
            automation.patternType === "navigation" &&
            Array.isArray(patternData.steps)
          ) {
            const firstNav = patternData.steps.find(
              (step: { url?: string }) =>
                step.url && step.url.startsWith("http"),
            );
            if (firstNav && firstNav.url) {
              startUrl = firstNav.url;
              log.info(
                "[PatternManager] Using URL from first navigation step:",
                startUrl,
              );
            }
          }

          // For copy-paste patterns, extract source URL (first copy step)
          if (
            automation.patternType === "copy-paste" &&
            Array.isArray(patternData.steps)
          ) {
            log.info("[PatternManager] Looking for sourceUrl in copy steps:", {
              firstStep: patternData.steps[0],
            });
            const firstCopy = patternData.steps.find(
              (step: { sourceUrl?: string }) =>
                step.sourceUrl && step.sourceUrl.startsWith("http"),
            );
            if (firstCopy && firstCopy.sourceUrl) {
              startUrl = firstCopy.sourceUrl;
              log.info(
                "[PatternManager] Using URL from first copy step:",
                startUrl,
              );
            }
          }
        } catch (error) {
          log.error(
            "[PatternManager] Failed to parse original pattern data:",
            error,
          );
        }
      }

      // Warn if no start URL found (workflow may be invalid or cross-tab pattern)
      if (!startUrl) {
        log.warn(
          "[PatternManager] No start URL found in workflow - will default to Google",
          {
            automationId,
            workflowKeys: workflow ? Object.keys(workflow) : [],
            patternType: automation.patternType,
          },
        );
      }

      // Create new tab for automation execution
      const automationTab = _window.createTab(startUrl || undefined);

      // Switch to the new tab so user can watch the automation
      _window.switchActiveTab(automationTab.id);

      // Import LLMExecutionEngine dynamically to avoid circular dependency
      const { LLMExecutionEngine } = await import("./LLMExecutionEngine");
      const executionEngine = new LLMExecutionEngine();

      // Track execution engine and ID for cancellation (Story 1.16)
      this.currentExecutionEngine = executionEngine;
      this.currentExecutionId = automationId;

      // Enable automation mode (blue haze overlay)
      automationTab.setAutomationMode(true);

      try {
        // Execute automation with LLM guidance (Story 1.16)
        const result = await executionEngine.executeAutomation(
          {
            id: automation.id,
            name: automation.name,
            description: automation.description,
            intentSummary: automation.intentSummary,
            workflow: undefined, // Will be parsed from patternData
            patternData: automation.patternData,
          },
          automationTab,
          onProgress,
        );

        // Update execution statistics if successful
        if (result.success) {
          const updateStmt = this.db.prepare(`
          UPDATE automations
          SET execution_count = execution_count + 1,
              last_executed = ?
          WHERE id = ?
        `);

          updateStmt.run(Date.now(), automationId);

          log.info("[PatternManager] Automation execution complete", {
            automationId,
            stepsExecuted: result.stepsExecuted,
            duration: result.duration,
          });
        }

        return {
          success: result.success,
          data: {
            stepsExecuted: result.stepsExecuted,
            duration: result.duration,
            error: result.error,
          },
          error: result.error
            ? {
                code: "EXECUTION_ERROR",
                message: result.error,
              }
            : undefined,
        };
      } finally {
        // Disable automation mode (remove blue haze overlay)
        automationTab.setAutomationMode(false);

        // Clear execution engine reference and ID (Story 1.16)
        this.currentExecutionEngine = null;
        this.currentExecutionId = null;
      }
    } catch (error) {
      log.error("[PatternManager] Execute automation error:", error);
      return {
        success: false,
        error: {
          code: "EXECUTION_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Cancel currently executing automation (Story 1.16)
   * Returns automation ID if cancelled, null if no execution in progress
   */
  public cancelExecution(): string | null {
    if (this.currentExecutionEngine && this.currentExecutionId) {
      this.currentExecutionEngine.cancel();
      log.info("[PatternManager] Automation execution cancelled");
      return this.currentExecutionId;
    }
    return null;
  }

  /**
   * Track navigation event and store in pattern database
   * Groups navigations into sessions based on 30-minute gap threshold
   */
  public async trackNavigation(
    event: NavigationEvent,
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      const SESSION_GAP_MS = 30 * 60 * 1000; // 30 minutes

      // Find most recent navigation pattern for this tab
      const lastPatternStmt = this.db.prepare(`
        SELECT id, pattern_data, last_seen
        FROM patterns
        WHERE type = 'navigation'
        AND json_extract(pattern_data, '$.sequence[#-1].tabId') = ?
        ORDER BY last_seen DESC
        LIMIT 1
      `);

      const lastPattern = lastPatternStmt.get(event.tabId) as
        | { id: string; pattern_data: string; last_seen: number }
        | undefined;

      // Check if we should continue existing session or start new one
      const shouldStartNewSession =
        !lastPattern ||
        event.timestamp - lastPattern.last_seen > SESSION_GAP_MS;

      if (shouldStartNewSession) {
        // Create new navigation pattern session
        const patternId = uuidv4();
        const newPattern: NavigationPattern = {
          sequence: [
            {
              url: event.url,
              timestamp: event.timestamp,
              tabId: event.tabId,
              pageTitle: event.pageTitle, // Enhanced context (Story 1.12)
            },
          ],
          sessionGap: SESSION_GAP_MS,
        };

        const insertStmt = this.db.prepare(`
          INSERT INTO patterns (
            id, type, pattern_data, confidence, occurrence_count,
            first_seen, last_seen, created_at
          ) VALUES (?, 'navigation', ?, 0, 1, ?, ?, ?)
        `);

        insertStmt.run(
          patternId,
          JSON.stringify(newPattern),
          event.timestamp,
          event.timestamp,
          event.timestamp,
        );

        log.info("[PatternManager] New navigation session started:", {
          patternId,
          url: event.url,
          tabId: event.tabId,
        });
      } else {
        // Append to existing session
        const existingPattern: NavigationPattern = JSON.parse(
          lastPattern.pattern_data,
        );

        // Deduplicate consecutive URLs (Story 1.14 - Bug fix)
        // Only add if different from last URL in sequence
        const lastUrl =
          existingPattern.sequence[existingPattern.sequence.length - 1]?.url;
        const isDuplicate = lastUrl === event.url;

        if (!isDuplicate) {
          existingPattern.sequence.push({
            url: event.url,
            timestamp: event.timestamp,
            tabId: event.tabId,
            pageTitle: event.pageTitle, // Enhanced context (Story 1.12)
          });

          const updateStmt = this.db.prepare(`
            UPDATE patterns
            SET pattern_data = ?, last_seen = ?
            WHERE id = ?
          `);

          updateStmt.run(
            JSON.stringify(existingPattern),
            event.timestamp,
            lastPattern.id,
          );

          log.info("[PatternManager] Navigation appended to session:", {
            patternId: lastPattern.id,
            sequenceLength: existingPattern.sequence.length,
            url: event.url,
          });
        } else {
          // Update last_seen even for duplicates (keeps session active)
          const updateLastSeenStmt = this.db.prepare(`
            UPDATE patterns SET last_seen = ? WHERE id = ?
          `);
          updateLastSeenStmt.run(event.timestamp, lastPattern.id);

          log.info(
            "[PatternManager] Duplicate URL skipped (keeping session active):",
            {
              patternId: lastPattern.id,
              url: event.url,
            },
          );
        }
      }

      // Run cleanup if needed (lightweight check)
      await this.cleanupOldPatterns();

      // Track session action for LLM pattern analysis (Story 1.15)
      await this.trackSessionAndAnalyze({
        type: "navigation",
        url: event.url,
        pageTitle: event.pageTitle,
        timestamp: event.timestamp,
        tabId: event.tabId,
        eventType: event.eventType,
      });

      return { success: true };
    } catch (error) {
      log.error("[PatternManager] Track navigation error:", error);
      return {
        success: false,
        error: {
          code: "TRACK_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Track form submission and store in pattern database
   * Groups form submissions by domain + field names hash
   * Triggers notification when occurrence_count reaches threshold (3)
   */
  public async trackFormSubmission(
    data: FormSubmissionData,
  ): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      const DETECTION_THRESHOLD = 3; // Trigger notification after 3 identical submissions

      // Generate pattern hash for matching (domain + sorted field names)
      const fieldNames = data.fields
        .map((f) => f.name)
        .sort()
        .join(",");
      const patternHash = `${data.domain}::${fieldNames}`;

      // Find existing pattern with same domain and field names
      const existingPatternStmt = this.db.prepare(`
        SELECT id, pattern_data, occurrence_count, confidence
        FROM patterns
        WHERE type = 'form'
        AND json_extract(pattern_data, '$.domain') = ?
        ORDER BY last_seen DESC
      `);

      const existingPatterns = existingPatternStmt.all(data.domain) as Array<{
        id: string;
        pattern_data: string;
        occurrence_count: number;
        confidence: number;
      }>;

      // Find matching pattern by comparing field names
      let matchingPattern: (typeof existingPatterns)[0] | undefined;
      for (const pattern of existingPatterns) {
        const patternData: FormPattern = JSON.parse(pattern.pattern_data);
        const existingFieldNames = patternData.fields
          .map((f) => f.name)
          .sort()
          .join(",");

        if (
          existingFieldNames === fieldNames &&
          patternData.formSelector === data.formSelector
        ) {
          matchingPattern = pattern;
          break;
        }
      }

      if (matchingPattern) {
        // Increment occurrence count for existing pattern
        const newOccurrenceCount = matchingPattern.occurrence_count + 1;
        const newConfidence = Math.min(newOccurrenceCount * 20, 100); // Max 100%

        const updateStmt = this.db.prepare(`
          UPDATE patterns
          SET occurrence_count = ?,
              confidence = ?,
              last_seen = ?
          WHERE id = ?
        `);

        updateStmt.run(
          newOccurrenceCount,
          newConfidence,
          data.timestamp,
          matchingPattern.id,
        );

        log.info("[PatternManager] Form pattern occurrence incremented:", {
          patternId: matchingPattern.id,
          domain: data.domain,
          occurrenceCount: newOccurrenceCount,
          confidence: newConfidence,
        });

        // Generate intent summaries if confidence >70% (Story 1.12 - AC 1)
        if (newConfidence > 70 && this.intentSummarizer) {
          try {
            const summaries = await this.intentSummarizer.summarizePattern(
              matchingPattern.id,
            );
            log.info(
              `[PatternManager] Intent summaries for ${matchingPattern.id}:\n  Short: "${summaries.short}"\n  Detailed: "${summaries.detailed}"`,
            );
          } catch (summaryError) {
            log.error(
              "[PatternManager] Failed to generate intent summaries:",
              summaryError,
            );
            // Continue without summary - pattern is still usable
          }
        }

        // Trigger notification if threshold reached
        if (newOccurrenceCount === DETECTION_THRESHOLD) {
          log.info(
            "[PatternManager] Form pattern threshold reached - notification triggered",
            {
              patternId: matchingPattern.id,
              domain: data.domain,
              formSelector: data.formSelector,
              fieldCount: data.fields.length,
            },
          );

          // Create notification through NotificationManager (Story 1.9)
          if (this.notificationManager) {
            const notification =
              await this.notificationManager.createNotification({
                type: "pattern",
                severity: "info",
                title: "Form pattern detected",
                message: `You've filled out a form on ${data.domain} with ${data.fields.length} fields ${newOccurrenceCount} times`,
                data: {
                  id: matchingPattern.id, // Must match PatternRecognizer format for SidebarApp.tsx
                  type: "form" as const,
                  confidence: newConfidence,
                  occurrenceCount: newOccurrenceCount,
                  patternData: JSON.parse(matchingPattern.pattern_data),
                },
              });

            if (notification) {
              log.info(
                "[PatternManager] Form notification created",
                notification.id,
              );
            }
          }
        }
      } else {
        // Create new form pattern
        const patternId = `form-${patternHash}-${Date.now()}`;
        const formPattern: FormPattern = {
          domain: data.domain,
          formSelector: data.formSelector,
          fields: data.fields,
        };

        const insertStmt = this.db.prepare(`
          INSERT INTO patterns (
            id, type, pattern_data, confidence, occurrence_count,
            first_seen, last_seen, created_at
          ) VALUES (?, 'form', ?, 0, 1, ?, ?, ?)
        `);

        insertStmt.run(
          patternId,
          JSON.stringify(formPattern),
          data.timestamp,
          data.timestamp,
          data.timestamp,
        );

        log.info("[PatternManager] New form pattern created:", {
          patternId,
          domain: data.domain,
          formSelector: data.formSelector,
          fieldCount: data.fields.length,
        });
      }

      // Run cleanup if needed
      await this.cleanupOldPatterns();

      // Track session action for LLM pattern analysis (Story 1.15)
      await this.trackSessionAndAnalyze({
        type: "form",
        url: `https://${data.domain}`,
        pageTitle: data.domain,
        timestamp: data.timestamp,
        tabId: data.tabId,
        domain: data.domain,
        formSelector: data.formSelector,
        fields: data.fields,
      });

      return { success: true };
    } catch (error) {
      log.error("[PatternManager] Track form submission error:", error);
      return {
        success: false,
        error: {
          code: "TRACK_FORM_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Track session action and analyze with LLM
   * Story 1.15 - AC 1, 2, 3: LLM-powered pattern detection
   * Code Review Fix: Added pattern deduplication and rate limiting
   */
  private async trackSessionAndAnalyze(action: SessionAction): Promise<void> {
    try {
      if (!this.llmAnalyzer || !this.db) {
        return;
      }

      // Add action to session
      this.sessionActions.push(action);

      // Clean up old actions (keep last 10 minutes)
      const TEN_MINUTES_MS = 10 * 60 * 1000;
      this.sessionActions = this.sessionActions.filter(
        (a) => action.timestamp - a.timestamp < TEN_MINUTES_MS,
      );

      // Group actions by type
      const sameTypeActions = this.sessionActions.filter(
        (a) => a.type === action.type,
      );

      // Check if we have enough iterations for analysis (2-3 actions)
      if (sameTypeActions.length < 2 || sameTypeActions.length > 4) {
        return; // Wait for 2-3 iterations before analyzing
      }

      // CODE REVIEW FIX #3: Rate limiting - max 1 LLM call per 5 seconds per pattern type
      const RATE_LIMIT_MS = 5000; // 5 seconds
      const lastCallTime = this.lastLLMCallTimestamps.get(action.type) || 0;
      const timeSinceLastCall = Date.now() - lastCallTime;

      if (timeSinceLastCall < RATE_LIMIT_MS) {
        log.info(
          `[PatternManager] Rate limit: Skipping LLM call for ${action.type} (${(RATE_LIMIT_MS - timeSinceLastCall) / 1000}s remaining)`,
        );
        return;
      }

      // CODE REVIEW FIX #1: Pattern deduplication - check if pattern already exists
      log.info(
        `[PatternManager] Checking for existing ${action.type} patterns before LLM call...`,
      );
      const existingPattern = await this.findMatchingPattern(
        sameTypeActions,
        action.type,
      );
      if (existingPattern) {
        if (existingPattern.dismissed === 0) {
          log.info(
            `[PatternManager] Pattern already detected (${existingPattern.id}), skipping LLM call`,
          );
          return;
        } else {
          log.info(
            `[PatternManager] Similar pattern found but dismissed (${existingPattern.id}), will re-analyze with LLM`,
          );
        }
      } else {
        log.info(
          `[PatternManager] No existing patterns found, proceeding with LLM call`,
        );
      }

      log.info(
        `[PatternManager] Analyzing ${sameTypeActions.length} ${action.type} actions with LLM`,
      );

      // Update rate limit timestamp
      this.lastLLMCallTimestamps.set(action.type, Date.now());

      // Analyze with LLM
      const analysis =
        await this.llmAnalyzer.analyzeActionSequence(sameTypeActions);

      if (analysis.isPattern && analysis.confidence > 70) {
        // LLM confirmed pattern with high confidence
        log.info(
          `[PatternManager] LLM detected pattern: ${analysis.intentSummary} (confidence: ${analysis.confidence}%)`,
        );

        // Save pattern to database
        // CODE REVIEW FIX #2: Use UUID consistently instead of timestamp
        const patternId = uuidv4();
        const now = Date.now();

        const stmt = this.db.prepare(`
          INSERT INTO patterns (
            id, type, pattern_data, confidence, occurrence_count,
            first_seen, last_seen, created_at, intent_summary, summary_generated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run(
          patternId,
          action.type,
          JSON.stringify(analysis.workflow), // LLM-decided workflow format
          analysis.confidence,
          sameTypeActions.length, // Occurrence count
          sameTypeActions[0].timestamp, // First action timestamp
          now, // Last seen
          now, // Created at
          analysis.intentSummary, // Intent summary from LLM (Story 1.15 - AC 2)
          now, // Summary generated at
        );

        log.info(`[PatternManager] Pattern saved: ${patternId}`);

        // Create notification
        if (this.notificationManager) {
          await this.notificationManager.createNotification({
            type: "pattern",
            severity: "info",
            title: "Pattern detected",
            message: `I noticed you're ${analysis.intentSummary}. Want me to help?`,
            data: {
              id: patternId,
              type: action.type,
              confidence: analysis.confidence,
              occurrenceCount: sameTypeActions.length,
              patternData: analysis.workflow,
            },
          });
        }

        // Clear session actions after pattern detection
        this.sessionActions = [];
      } else if (!analysis.isPattern) {
        // LLM rejected pattern (Story 1.15 - AC 3)
        log.info(
          `[PatternManager] LLM rejected pattern: ${analysis.rejectionReason || "Not a repetitive pattern"}`,
        );

        // Clear rejected actions to avoid accumulation (Story 1.15 - AC 3)
        this.sessionActions = this.sessionActions.filter(
          (a) => a.type !== action.type,
        );
      }
    } catch (error) {
      log.error("[PatternManager] LLM pattern analysis error:", error);
      // Continue without pattern detection - non-critical
    }
  }

  /**
   * Find matching pattern in database to avoid duplicate LLM calls
   * Code Review Fix #1: Pattern deduplication
   */
  private async findMatchingPattern(
    actions: SessionAction[],
    patternType: string,
  ): Promise<{ id: string; dismissed: number } | null> {
    try {
      if (!this.db) {
        return null;
      }

      // Query recent patterns of the same type (last 7 days, not dismissed)
      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const cutoffTime = Date.now() - SEVEN_DAYS_MS;

      const stmt = this.db.prepare(`
        SELECT id, pattern_data, dismissed
        FROM patterns
        WHERE type = ?
        AND created_at > ?
        ORDER BY created_at DESC
        LIMIT 20
      `);

      const patterns = stmt.all(patternType, cutoffTime) as Array<{
        id: string;
        pattern_data: string;
        dismissed: number;
      }>;

      log.info(
        `[PatternManager] Deduplication: Found ${patterns.length} existing ${patternType} patterns to compare`,
      );

      // Compare action sequences to find similar patterns
      for (const pattern of patterns) {
        log.info(
          `[PatternManager] Deduplication: Comparing against pattern ${pattern.id.substring(0, 8)}... (dismissed: ${pattern.dismissed})`,
        );

        if (this.isSimilarPattern(actions, pattern.pattern_data, patternType)) {
          log.info(
            `[PatternManager] Deduplication: MATCH FOUND - Pattern ${pattern.id} is similar`,
          );
          return { id: pattern.id, dismissed: pattern.dismissed };
        } else {
          log.info(
            `[PatternManager] Deduplication: No match - Pattern ${pattern.id.substring(0, 8)}... is different`,
          );
        }
      }

      log.info(
        `[PatternManager] Deduplication: No similar patterns found, will call LLM`,
      );
      return null;
    } catch (error) {
      log.error("[PatternManager] Error finding matching pattern:", error);
      return null;
    }
  }

  /**
   * Check if action sequence is similar to existing pattern
   * Code Review Fix #1: Pattern similarity comparison
   */
  private isSimilarPattern(
    actions: SessionAction[],
    patternDataStr: string,
    patternType: string,
  ): boolean {
    try {
      // For navigation patterns: compare URLs
      if (patternType === "navigation") {
        const urls = actions.map((a) => a.url).filter(Boolean);
        // Check if pattern includes similar URL sequence
        // Simple heuristic: same domain patterns
        const domains = urls.map((url) => {
          try {
            return new URL(url!).hostname;
          } catch {
            return "";
          }
        });
        const uniqueDomains = new Set(domains);

        log.info(
          `[PatternManager] Similarity check (navigation): Action domains: [${Array.from(uniqueDomains).join(", ")}]`,
        );

        // If pattern involves same domain(s), consider it similar
        const patternData = JSON.parse(patternDataStr);
        if (patternData.steps) {
          // LLM-generated workflow format
          const patternDomains = new Set(
            patternData.steps
              .map((step: { url?: string }) => {
                if (step.url) {
                  try {
                    return new URL(step.url).hostname;
                  } catch {
                    return "";
                  }
                }
                return "";
              })
              .filter(Boolean),
          );

          log.info(
            `[PatternManager] Similarity check (navigation): Pattern domains: [${Array.from(patternDomains).join(", ")}]`,
          );

          // Check if domains overlap
          for (const domain of uniqueDomains) {
            if (patternDomains.has(domain)) {
              log.info(
                `[PatternManager] Similarity check (navigation): Domain match found: ${domain}`,
              );
              return true;
            }
          }
        }
      }

      // For form patterns: compare domains
      if (patternType === "form") {
        const domains = actions
          .map((a) => a.domain)
          .filter(Boolean) as string[];
        const patternData = JSON.parse(patternDataStr);

        log.info(
          `[PatternManager] Similarity check (form): Action domains: [${domains.join(", ")}]`,
        );
        log.info(
          `[PatternManager] Similarity check (form): Pattern domain: ${patternData.domain || "none"}`,
        );

        if (
          patternData.domain &&
          domains.some((d) => d === patternData.domain)
        ) {
          log.info(
            `[PatternManager] Similarity check (form): Domain match found`,
          );
          return true;
        }
      }

      // For copy-paste patterns: compare source/destination URL pairs
      if (patternType === "copy-paste") {
        const pairs = actions
          .map((a) => `${a.sourceUrl || ""}->${a.destinationUrl || ""}`)
          .filter((p) => p !== "->");

        log.info(
          `[PatternManager] Similarity check (copy-paste): Action pairs: [${pairs.join(", ")}]`,
        );

        const patternData = JSON.parse(patternDataStr);
        if (patternData.steps) {
          // LLM-generated workflow
          const patternPairs = patternData.steps
            .filter((s: { action?: string }) => s.action === "paste")
            .map(
              (s: { sourceUrl?: string; destinationUrl?: string }) =>
                `${s.sourceUrl || ""}->${s.destinationUrl || ""}`,
            );

          log.info(
            `[PatternManager] Similarity check (copy-paste): Pattern pairs from workflow: [${patternPairs.join(", ")}]`,
          );

          // Check if any pair matches
          for (const pair of pairs) {
            if (patternPairs.includes(pair)) {
              log.info(
                `[PatternManager] Similarity check (copy-paste): Pair match found: ${pair}`,
              );
              return true;
            }
          }

          log.info(
            `[PatternManager] Similarity check (copy-paste): No pair matches found`,
          );
        } else {
          log.info(
            `[PatternManager] Similarity check (copy-paste): Pattern has no steps field in workflow`,
          );
        }
      }

      return false;
    } catch (error) {
      log.error("[PatternManager] Error comparing pattern similarity:", error);
      return false;
    }
  }

  /**
   * Clean up old patterns based on retention policy
   * - Delete patterns older than 30 days
   * - Enforce max 100 patterns using FIFO deletion
   */
  public async cleanupOldPatterns(): Promise<void> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      const RETENTION_DAYS = 30;
      const MAX_PATTERNS = 100;
      const cutoffTime = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

      // Delete old patterns (30 days)
      const deleteOldStmt = this.db.prepare(`
        DELETE FROM patterns
        WHERE created_at < ?
      `);
      const oldResult = deleteOldStmt.run(cutoffTime);

      if (oldResult.changes > 0) {
        log.info(
          "[PatternManager] Cleanup: Deleted old patterns:",
          oldResult.changes,
        );
      }

      // Enforce max pattern limit (FIFO)
      const countStmt = this.db.prepare(
        "SELECT COUNT(*) as count FROM patterns",
      );
      const result = countStmt.get() as { count: number } | undefined;
      const count = result?.count || 0;

      if (count > MAX_PATTERNS) {
        const excessCount = count - MAX_PATTERNS;
        const deleteFifoStmt = this.db.prepare(`
          DELETE FROM patterns
          WHERE id IN (
            SELECT id FROM patterns
            ORDER BY created_at ASC
            LIMIT ?
          )
        `);
        const fifoResult = deleteFifoStmt.run(excessCount);

        log.info(
          "[PatternManager] Cleanup: FIFO deletion:",
          fifoResult.changes,
        );
      }
    } catch (error) {
      log.error("[PatternManager] Cleanup error:", error);
    }
  }

  /**
   * Save a manually recorded automation (Story 1.11)
   *
   * Converts recorded actions to pattern_data and saves to automations table
   */
  public async saveManualRecording(
    data: SaveRecordingInput,
  ): Promise<IPCResponse<{ automationId: string }>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      log.info("[PatternManager] Save manual recording:", data.name);

      // Determine pattern type from actions
      const hasNavigation = data.actions.some((a) => a.type === "navigation");
      const hasForms = data.actions.some((a) => a.type === "form");

      let patternType: PatternType;
      let patternData: NavigationPattern | FormPattern;

      if (hasForms) {
        // Form pattern (Story 1.7)
        patternType = "form";
        const formAction = data.actions.find((a) => a.type === "form");
        if (formAction) {
          patternData = {
            domain: formAction.data.domain,
            formSelector: formAction.data.formSelector,
            fields: formAction.data.fields,
          };
        } else {
          // Fallback if no form action found (shouldn't happen)
          throw new Error("No form action found in recording");
        }
      } else if (hasNavigation) {
        // Navigation pattern (Story 1.6)
        patternType = "navigation";
        const navActions = data.actions.filter((a) => a.type === "navigation");
        patternData = {
          sequence: navActions.map((a) => ({
            url: a.data.url,
            timestamp: a.timestamp,
            tabId: a.data.tabId || "manual",
          })),
          sessionGap: 1800000, // 30 minutes (standard)
        };
      } else {
        // Default to navigation pattern with empty sequence
        patternType = "navigation";
        patternData = {
          sequence: [],
          sessionGap: 1800000,
        };
      }

      // Create pattern ID and automation ID
      const patternId = `${patternType}-manual-${uuidv4()}`;
      const automationId = uuidv4();

      // Create pattern in database (won't trigger notifications since confidence = 100%)
      const now = Date.now();
      const patternStmt = this.db.prepare(`
        INSERT INTO patterns (id, type, pattern_data, confidence, occurrence_count, first_seen, last_seen, created_at, dismissed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      patternStmt.run(
        patternId,
        patternType,
        JSON.stringify(patternData),
        100, // Manual recordings have 100% confidence
        1, // Manually recorded = 1 occurrence
        now, // first_seen
        now, // last_seen
        now, // created_at
        0, // Not dismissed
      );

      // Create automation directly linked to pattern
      const automationStmt = this.db.prepare(`
        INSERT INTO automations (id, pattern_id, name, description, pattern_data, execution_count, last_executed, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      automationStmt.run(
        automationId,
        patternId,
        data.name,
        data.description || null,
        JSON.stringify(patternData),
        0, // No executions yet
        null, // Not executed yet
        Date.now(),
      );

      log.info(
        "[PatternManager] Manual recording saved successfully:",
        automationId,
      );

      return {
        success: true,
        data: { automationId },
      };
    } catch (error) {
      log.error("[PatternManager] Failed to save manual recording:", error);
      return {
        success: false,
        error: {
          code: "SAVE_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Start copy event cleanup interval (Story 1.7b)
   * Cleans expired copy events every minute
   */
  private startCopyEventCleanup(): void {
    // Clean up expired copy events every 60 seconds
    this.copyEventCleanupInterval = setInterval(() => {
      this.cleanupExpiredCopyEvents();
    }, 60000);

    log.info("[PatternManager] Copy event cleanup interval started");
  }

  /**
   * Clean up copy events older than 5 minutes (Story 1.7b)
   */
  private cleanupExpiredCopyEvents(): void {
    const COPY_EVENT_MAX_AGE_MS = 5 * 60 * 1000; // 5 minutes
    const now = Date.now();
    const initialCount = this.recentCopyEvents.length;

    this.recentCopyEvents = this.recentCopyEvents.filter(
      (event) => now - event.timestamp < COPY_EVENT_MAX_AGE_MS,
    );

    const removed = initialCount - this.recentCopyEvents.length;
    if (removed > 0) {
      log.info(
        `[PatternManager] Cleaned up ${removed} expired copy events (${this.recentCopyEvents.length} remaining)`,
      );
    }
  }

  /**
   * Track copy/paste workflow (Story 1.7b)
   * AC 1: Captures copy event with source context, paste event with destination context
   * AC 1: Links copy-paste pairs (max 5 minute gap)
   * AC 1: Hashes sensitive content (passwords, credit cards, SSN)
   * AC 1: Persists patterns with type='copy-paste'
   */
  public async trackCopyPaste(data: {
    copyEvent?: {
      text: string;
      sourceElement: string;
      url: string;
      pageTitle: string;
      timestamp: number;
      tabId: string;
    };
    pasteEvent?: {
      destinationElement: string;
      url: string;
      pageTitle: string;
      timestamp: number;
      tabId: string;
    };
  }): Promise<IPCResponse<void>> {
    try {
      if (!this.db) {
        throw new Error("PatternManager not initialized");
      }

      const COPY_PASTE_MAX_GAP_MS = 5 * 60 * 1000; // 5 minutes
      const MAX_COPY_EVENTS = 100; // Limit in-memory storage

      // Handle copy event
      if (data.copyEvent) {
        const { text, sourceElement, url, pageTitle, timestamp, tabId } =
          data.copyEvent;

        // Import crypto for hashing
        const crypto = await import("crypto");

        // Check if content is sensitive
        const isSensitive = this.isSensitiveContent(sourceElement, text);

        // Always create hash (for pattern matching)
        const textHash = crypto.createHash("sha256").update(text).digest("hex");

        // Store copy event in memory
        const copyEventData: CopyEventData = {
          text: isSensitive ? "" : text, // Don't store plaintext if sensitive
          textHash,
          sourceElement,
          url,
          pageTitle,
          timestamp,
          tabId,
          isSensitive,
        };

        this.recentCopyEvents.push(copyEventData);

        // Enforce max copy events limit
        if (this.recentCopyEvents.length > MAX_COPY_EVENTS) {
          this.recentCopyEvents.shift(); // Remove oldest
        }

        if (isSensitive) {
          log.info(
            "[PatternManager] Copy event tracked (sensitive content hashed):",
            {
              sourceElement,
              url,
              timestamp,
            },
          );
        } else {
          log.info("[PatternManager] Copy event tracked:", {
            text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
            sourceElement,
            url,
            timestamp,
          });
        }

        return { success: true };
      }

      // Handle paste event
      if (data.pasteEvent) {
        const { destinationElement, url, pageTitle, timestamp } =
          data.pasteEvent;

        // Find most recent copy event (within 5 minute window)
        const now = timestamp;
        const recentCopy = this.recentCopyEvents
          .filter((event) => now - event.timestamp < COPY_PASTE_MAX_GAP_MS)
          .sort((a, b) => b.timestamp - a.timestamp)[0]; // Most recent first

        if (!recentCopy) {
          log.warn(
            "[PatternManager] Paste event without recent copy - no pair created",
          );
          return { success: true }; // Don't fail, just don't create pair
        }

        // Calculate time gap
        const timeGap = timestamp - recentCopy.timestamp;

        // Create copy-paste pair
        const pair: CopyPastePair = {
          copiedText: recentCopy.isSensitive ? undefined : recentCopy.text, // Only include if not sensitive
          copiedTextHash: recentCopy.textHash,
          sourceUrl: recentCopy.url,
          sourceElement: recentCopy.sourceElement,
          sourcePageTitle: recentCopy.pageTitle,
          destinationUrl: url,
          destinationElement,
          destinationPageTitle: pageTitle,
          timestamp,
          timeGap,
        };

        log.info("[PatternManager] Copy-paste pair created:", {
          sourceUrl: pair.sourceUrl,
          destinationUrl: pair.destinationUrl,
          timeGap: `${(timeGap / 1000).toFixed(1)}s`,
        });

        // Track session action for LLM pattern analysis (Story 1.15)
        await this.trackSessionAndAnalyze({
          type: "copy-paste",
          url: pair.destinationUrl,
          pageTitle: pair.destinationPageTitle,
          timestamp,
          tabId: data.pasteEvent?.tabId || "unknown",
          sourceUrl: pair.sourceUrl,
          destinationUrl: pair.destinationUrl,
          sourceElement: pair.sourceElement,
          destinationElement: pair.destinationElement,
          copiedText: pair.copiedText,
        });

        // Return early - LLM has handled pattern detection (Story 1.15)
        return { success: true };
      }

      // If neither copy nor paste event provided
      log.warn(
        "[PatternManager] trackCopyPaste called without copy or paste event",
      );
      return {
        success: false,
        error: {
          code: "INVALID_INPUT",
          message: "Either copyEvent or pasteEvent required",
        },
      };
    } catch (error) {
      log.error("[PatternManager] Track copy-paste error:", error);
      return {
        success: false,
        error: {
          code: "TRACK_COPY_PASTE_ERROR",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Check if content is sensitive (Story 1.7b - AC 1)
   * Detects password fields, credit card patterns, SSN patterns
   */
  private isSensitiveContent(element: string, text: string): boolean {
    // Password field detection (input[type="password"])
    if (element.includes('type="password"') || element.includes("password")) {
      return true;
    }

    // Credit card pattern detection
    const ccPattern = /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/;
    if (ccPattern.test(text)) {
      return true;
    }

    // SSN pattern detection
    const ssnPattern = /\d{3}-\d{2}-\d{4}/;
    if (ssnPattern.test(text)) {
      return true;
    }

    return false;
  }

  /**
   * Clean up resources
   */
  public async cleanup(): Promise<void> {
    try {
      log.info("[PatternManager] Cleaning up...");

      // Stop copy event cleanup interval (Story 1.7b)
      if (this.copyEventCleanupInterval) {
        clearInterval(this.copyEventCleanupInterval);
        this.copyEventCleanupInterval = null;
      }

      this.db = null;
      log.info("[PatternManager] Cleanup completed");
    } catch (error) {
      log.error("[PatternManager] Cleanup failed:", error);
    }
  }

  /**
   * Destroy the singleton instance (for testing)
   */
  public static destroy(): void {
    PatternManager.instance = null;
  }
}
