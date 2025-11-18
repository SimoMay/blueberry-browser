import log from "electron-log";
import { Window } from "./Window";

/**
 * Recording session interface
 */
export interface RecordingSession {
  tabId: string;
  startTime: number;
  actions: RecordedAction[];
  status: "active" | "paused" | "stopped";
  timeoutHandle?: NodeJS.Timeout;
}

/**
 * Base recorded action interface
 */
export interface RecordedAction {
  type: "navigation" | "form" | "click";
  timestamp: number;
  data: NavigationAction | FormAction | ClickAction;
}

/**
 * Navigation action data
 */
export interface NavigationAction {
  url: string;
  tabId: string;
}

/**
 * Form action data
 */
export interface FormAction {
  domain: string;
  formSelector: string;
  fields: Array<{ name: string; valuePattern: string }>;
}

/**
 * Click action data
 */
export interface ClickAction {
  selector: string;
  textContent: string;
  url: string;
}

/**
 * Recording preview data returned when stopping
 */
export interface RecordingPreview {
  actions: RecordedAction[];
  tabId: string;
  duration: number; // in seconds
}

/**
 * RecordingManager class - Manages manual action recording sessions
 *
 * Responsibilities:
 * - Start/stop recording sessions on tabs
 * - Capture actions (navigation, form, click)
 * - Enforce limits (5 min timeout, 100 actions max)
 * - Handle pause/resume on tab switching
 * - Emit IPC events for UI updates
 */
export class RecordingManager {
  private window: Window;
  private recordingSessions: Map<string, RecordingSession> = new Map();
  private readonly MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes
  private readonly MAX_ACTIONS = 100;

  constructor(window: Window) {
    this.window = window;
  }

  /**
   * Start a new recording session on the specified tab
   */
  startRecording(tabId: string): {
    success: boolean;
    error?: {
      code: string;
      message: string;
      tabId?: string;
      tabTitle?: string;
    };
  } {
    try {
      // Check if ANY recording exists (active or paused - only one allowed at a time)
      const existingRecording = Array.from(
        this.recordingSessions.values(),
      ).find((s) => s.status === "active" || s.status === "paused");

      if (existingRecording) {
        const tab = this.window.getTab(existingRecording.tabId);
        return {
          success: false,
          error: {
            code: "RECORDING_ACTIVE",
            message: `Recording already in progress on tab "${tab?.title || existingRecording.tabId}" (tabId: ${existingRecording.tabId})`,
            tabId: existingRecording.tabId,
            tabTitle: tab?.title || "Unknown",
          },
        };
      }

      // Verify tab exists
      const tab = this.window.getTab(tabId);
      if (!tab) {
        return {
          success: false,
          error: {
            code: "TAB_NOT_FOUND",
            message: `Tab ${tabId} not found`,
          },
        };
      }

      // Create new recording session
      const session: RecordingSession = {
        tabId,
        startTime: Date.now(),
        actions: [],
        status: "active",
      };

      // Set 5-minute timeout
      session.timeoutHandle = setTimeout(() => {
        this.handleTimeout(tabId);
      }, this.MAX_DURATION_MS);

      this.recordingSessions.set(tabId, session);

      // Inject recording overlay on tab
      tab.injectRecordingOverlay();

      log.info(
        `[RecordingManager] Recording started on tab ${tabId} (${tab.title})`,
      );
      return { success: true };
    } catch (error) {
      log.error("[RecordingManager] Failed to start recording:", error);
      return {
        success: false,
        error: {
          code: "START_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    }
  }

  /**
   * Get the current action count for a recording session (AC #9: zero-action check)
   */
  getActionCount(tabId: string): number {
    const session = this.recordingSessions.get(tabId);
    return session ? session.actions.length : 0;
  }

  /**
   * Stop the recording session and return captured data
   */
  stopRecording(tabId: string): {
    success: boolean;
    data?: RecordingPreview;
    error?: { code: string; message: string };
  } {
    const session = this.recordingSessions.get(tabId);

    if (!session) {
      return {
        success: false,
        error: {
          code: "NO_RECORDING",
          message: "No active recording found",
        },
      };
    }

    try {
      // Clear timeout
      if (session.timeoutHandle) {
        clearTimeout(session.timeoutHandle);
      }

      session.status = "stopped";

      // Remove overlay
      const tab = this.window.getTab(tabId);
      if (tab) {
        tab.removeRecordingOverlay();
      }

      const duration = (Date.now() - session.startTime) / 1000; // seconds

      log.info(
        `[RecordingManager] Recording stopped on tab ${tabId}: ${session.actions.length} actions in ${duration.toFixed(1)}s`,
      );

      const preview: RecordingPreview = {
        actions: session.actions,
        tabId,
        duration,
      };

      return {
        success: true,
        data: preview,
      };
    } catch (error) {
      log.error("[RecordingManager] Failed to stop recording:", error);
      return {
        success: false,
        error: {
          code: "STOP_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        },
      };
    } finally {
      this.recordingSessions.delete(tabId);
    }
  }

  /**
   * Capture an action during recording
   */
  captureAction(tabId: string, action: RecordedAction): void {
    const session = this.recordingSessions.get(tabId);

    if (!session || session.status !== "active") {
      return;
    }

    try {
      // Check max actions limit
      if (session.actions.length >= this.MAX_ACTIONS) {
        log.warn(
          `[RecordingManager] Max actions limit (${this.MAX_ACTIONS}) reached for tab ${tabId}`,
        );
        this.handleTimeout(tabId); // Auto-stop
        return;
      }

      // Deduplicate consecutive navigation to same URL
      if (action.type === "navigation") {
        const lastAction = session.actions[session.actions.length - 1];
        if (
          lastAction &&
          lastAction.type === "navigation" &&
          (lastAction.data as NavigationAction).url ===
            (action.data as NavigationAction).url
        ) {
          log.info(
            `[RecordingManager] Skipped duplicate navigation to ${(action.data as NavigationAction).url}`,
          );
          return;
        }
      }

      session.actions.push(action);

      log.info(
        `[RecordingManager] Action captured on tab ${tabId}: ${action.type} (${session.actions.length} total)`,
      );

      // Update recording counter in tab overlay
      const tab = this.window.getTab(tabId);
      if (tab) {
        tab.updateRecordingCounter(session.actions.length);
      }

      // Emit IPC event to update UI counter
      this.window.sendToSidebar("recording:action-captured", {
        tabId,
        actionCount: session.actions.length,
        actionType: action.type,
      });
    } catch (error) {
      log.error("[RecordingManager] Failed to capture action:", error);
    }
  }

  /**
   * Pause recording (e.g., when user switches tabs)
   */
  pauseRecording(tabId: string): void {
    const session = this.recordingSessions.get(tabId);
    if (session && session.status === "active") {
      session.status = "paused";

      const tab = this.window.getTab(tabId);
      log.info(
        `[RecordingManager] Recording paused on tab ${tabId} (${tab?.title || "Unknown"})`,
      );

      this.window.sendToSidebar("recording:status-changed", {
        status: "paused",
        tabId,
        message: `Recording paused - switch back to "${tab?.title || "tab"}" to continue`,
      });
    }
  }

  /**
   * Resume recording (e.g., when user returns to recording tab)
   */
  resumeRecording(tabId: string): void {
    const session = this.recordingSessions.get(tabId);
    if (session && session.status === "paused") {
      session.status = "active";

      const tab = this.window.getTab(tabId);
      log.info(
        `[RecordingManager] Recording resumed on tab ${tabId} (${tab?.title || "Unknown"})`,
      );

      this.window.sendToSidebar("recording:status-changed", {
        status: "resumed",
        tabId,
        message: "Recording resumed",
      });
    }
  }

  /**
   * Get current recording session for a tab
   */
  getRecordingSession(tabId: string): RecordingSession | undefined {
    return this.recordingSessions.get(tabId);
  }

  /**
   * Get active recording session (if any)
   */
  getActiveRecording(): RecordingSession | undefined {
    return Array.from(this.recordingSessions.values()).find(
      (s) => s.status === "active",
    );
  }

  /**
   * Check if a tab is currently recording
   */
  isRecording(tabId: string): boolean {
    const session = this.recordingSessions.get(tabId);
    return session !== undefined && session.status !== "stopped";
  }

  /**
   * Clean up stale recording state (e.g., on app startup)
   */
  clearStaleRecordings(): void {
    const count = this.recordingSessions.size;
    if (count > 0) {
      this.recordingSessions.forEach((session, tabId) => {
        if (session.timeoutHandle) {
          clearTimeout(session.timeoutHandle);
        }
        const tab = this.window.getTab(tabId);
        if (tab) {
          tab.removeRecordingOverlay();
        }
      });
      this.recordingSessions.clear();
      log.info(
        `[RecordingManager] Cleared ${count} stale recording session(s)`,
      );
    }
  }

  /**
   * Handle tab crash/destroy - cleanup recording gracefully (AC #10)
   */
  handleTabDestroyed(tabId: string): void {
    const session = this.recordingSessions.get(tabId);
    if (!session) return;

    try {
      // Clear timeout
      if (session.timeoutHandle) {
        clearTimeout(session.timeoutHandle);
      }

      // Clean up session
      this.recordingSessions.delete(tabId);

      log.error(
        `[RecordingManager] Recording stopped - tab crashed unexpectedly (tabId: ${tabId})`,
      );

      // Notify sidebar of error
      this.window.sendToSidebar("recording:status-changed", {
        status: "error",
        tabId,
        message: "Recording stopped. Tab closed unexpectedly.",
      });
    } catch (error) {
      log.error("[RecordingManager] Error handling tab destruction:", error);
    }
  }

  /**
   * Handle recording timeout (5 minutes)
   */
  private handleTimeout(tabId: string): void {
    const session = this.recordingSessions.get(tabId);
    if (!session) return;

    const tab = this.window.getTab(tabId);
    log.warn(
      `[RecordingManager] Recording timeout for tab ${tabId} (${tab?.title || "Unknown"})`,
    );

    const result = this.stopRecording(tabId);

    if (result.success && result.data) {
      this.window.sendToSidebar("recording:status-changed", {
        status: "timeout",
        tabId,
        message: "Recording stopped due to timeout (5 min limit)",
      });

      // Auto-open preview modal with timeout flag
      this.window.sendToSidebar("recording:timeout-preview", {
        ...result.data,
        isTimeout: true,
      });
    }
  }
}
