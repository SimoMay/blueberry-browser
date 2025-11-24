import { contextBridge } from "electron";
import log from "electron-log";
import { electronAPI } from "@electron-toolkit/preload";

interface ChatRequest {
  message: string;
  context: {
    url: string | null;
    content: string | null;
    text: string | null;
  };
  messageId: string;
}

interface ChatResponse {
  messageId: string;
  content: string;
  isComplete: boolean;
}

interface ChatMessage {
  id: string;
  role: string;
  content: string;
  timestamp: number;
}

// Sidebar specific APIs
const sidebarAPI = {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) =>
    electronAPI.ipcRenderer.invoke("sidebar-chat-message", request),

  clearChat: () => electronAPI.ipcRenderer.invoke("sidebar-clear-chat"),

  getMessages: () => electronAPI.ipcRenderer.invoke("sidebar-get-messages"),

  onChatResponse: (callback: (data: ChatResponse) => void) => {
    electronAPI.ipcRenderer.on("chat-response", (_, data) => callback(data));
  },

  onMessagesUpdated: (callback: (messages: ChatMessage[]) => void) => {
    electronAPI.ipcRenderer.on("chat-messages-updated", (_, messages) =>
      callback(messages as ChatMessage[]),
    );
  },

  removeChatResponseListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-response");
  },

  removeMessagesUpdatedListener: () => {
    electronAPI.ipcRenderer.removeAllListeners("chat-messages-updated");
  },

  // Page content access
  getPageContent: () => electronAPI.ipcRenderer.invoke("get-page-content"),
  getPageText: () => electronAPI.ipcRenderer.invoke("get-page-text"),
  getCurrentUrl: () => electronAPI.ipcRenderer.invoke("get-current-url"),

  // Tab information
  getActiveTabInfo: () => electronAPI.ipcRenderer.invoke("get-active-tab-info"),
  switchTab: (tabId: string) =>
    electronAPI.ipcRenderer.invoke("switch-tab", tabId),

  // Notification functionality
  notifications: {
    onReceive: (callback: (notification: unknown) => void) => {
      electronAPI.ipcRenderer.on("notification:show", (_, notification) =>
        callback(notification),
      );
    },

    removeReceiveListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("notification:show");
    },

    onShowPanel: (callback: () => void) => {
      electronAPI.ipcRenderer.on("show-notification-panel", () => callback());
    },

    removeShowPanelListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("show-notification-panel");
    },

    onShowChat: (callback: () => void) => {
      electronAPI.ipcRenderer.on("show-chat", () => callback());
    },

    removeShowChatListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("show-chat");
    },

    onToggleView: (callback: () => void) => {
      electronAPI.ipcRenderer.on("toggle-notification-view", () => callback());
    },

    removeToggleViewListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("toggle-notification-view");
    },

    getAll: (type?: string) =>
      electronAPI.ipcRenderer.invoke("notification:get-all", { type }),

    dismiss: (notificationId: string) =>
      electronAPI.ipcRenderer.invoke("notification:dismiss", {
        notificationId,
      }),

    dismissAll: () =>
      electronAPI.ipcRenderer.invoke("notification:dismiss-all"),

    getUnreadCount: () =>
      electronAPI.ipcRenderer.invoke("notification:get-unread-count"),

    createTest: (input?: {
      type?: string;
      severity?: string;
      title?: string;
      message?: string;
    }) => electronAPI.ipcRenderer.invoke("notification:create-test", input),
  },

  // Pattern detection functionality
  pattern: {
    getAll: (filters?: { type?: "navigation" | "form" | "copy-paste" }) =>
      electronAPI.ipcRenderer.invoke("pattern:get-all", filters),

    saveAutomation: (data: {
      pattern_id: string;
      name: string;
      description?: string;
    }) => electronAPI.ipcRenderer.invoke("pattern:save-automation", data),

    dismiss: (data: { patternId: string }) =>
      electronAPI.ipcRenderer.invoke("pattern:dismiss", data),

    onDetected: (callback: (pattern: unknown) => void) => {
      electronAPI.ipcRenderer.on("pattern:detected", (_, pattern) =>
        callback(pattern),
      );
    },

    removeDetectedListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("pattern:detected");
    },

    cancelExecution: (data: { executionId: string }) =>
      electronAPI.ipcRenderer.invoke("pattern:cancel-execution", data),

    onExecutionProgress: (
      callback: (data: {
        executionId: string;
        current: number;
        total: number;
        action: string;
      }) => void,
    ) => {
      electronAPI.ipcRenderer.on("execution:progress", (_, data) =>
        callback(data),
      );
    },

    removeExecutionProgressListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("execution:progress");
    },

    onExecutionComplete: (
      callback: (data: { executionId: string; itemsProcessed: number }) => void,
    ) => {
      electronAPI.ipcRenderer.on("execution:complete", (_, data) =>
        callback(data),
      );
    },

    removeExecutionCompleteListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("execution:complete");
    },

    onExecutionCancelled: (
      callback: (data: { executionId: string; stoppedAt: number }) => void,
    ) => {
      electronAPI.ipcRenderer.on("automation:execution-cancelled", (_, data) =>
        callback(data),
      );
    },

    removeExecutionCancelledListener: () => {
      electronAPI.ipcRenderer.removeAllListeners(
        "automation:execution-cancelled",
      );
    },

    onExecutionError: (
      callback: (data: { executionId: string; error: string }) => void,
    ) => {
      electronAPI.ipcRenderer.on("execution:error", (_, data) =>
        callback(data),
      );
    },

    removeExecutionErrorListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("execution:error");
    },
  },

  // Automation execution and management (Story 1.10)
  automations: {
    getAll: () => electronAPI.ipcRenderer.invoke("pattern:get-automations"),

    execute: (automationId: string) =>
      electronAPI.ipcRenderer.invoke(
        "pattern:execute-automation",
        automationId,
      ),

    edit: (data: {
      automationId: string;
      name: string;
      description?: string;
    }) => electronAPI.ipcRenderer.invoke("pattern:edit-automation", data),

    delete: (automationId: string) =>
      electronAPI.ipcRenderer.invoke("pattern:delete-automation", automationId),

    // Story 1.16: Cancel automation execution
    cancel: () => electronAPI.ipcRenderer.invoke("pattern:cancel-execution"),

    onProgress: (
      callback: (data: {
        automationId: string;
        currentStep: number;
        totalSteps: number;
        stepDescription: string;
        screenshot?: string; // AC 5: Screenshot thumbnail for progress display
      }) => void,
    ) => {
      electronAPI.ipcRenderer.on("automation:progress", (_, data) =>
        callback(data),
      );
    },

    removeProgressListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("automation:progress");
    },

    onComplete: (
      callback: (data: {
        automationId: string;
        success: boolean;
        stepsExecuted: number;
        error?: string;
      }) => void,
    ) => {
      electronAPI.ipcRenderer.on("automation:complete", (_, data) =>
        callback(data),
      );
    },

    removeCompleteListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("automation:complete");
    },

    // Convenience methods for event management
    on: (event: "progress" | "complete", callback: (data: unknown) => void) => {
      const eventName =
        event === "progress" ? "automation:progress" : "automation:complete";
      electronAPI.ipcRenderer.on(eventName, (_, data) => callback(data));
    },

    removeListener: (event: "progress" | "complete") => {
      const eventName =
        event === "progress" ? "automation:progress" : "automation:complete";
      electronAPI.ipcRenderer.removeAllListeners(eventName);
    },
  },

  // Workflow refinement (Story 1.17)
  workflow: {
    startRefinement: (automationId: string) =>
      electronAPI.ipcRenderer.invoke("workflow:start-refinement", automationId),

    sendMessage: (conversationId: string, message: string) =>
      electronAPI.ipcRenderer.invoke(
        "workflow:send-refinement-message",
        conversationId,
        message,
      ),

    saveRefined: (conversationId: string) =>
      electronAPI.ipcRenderer.invoke(
        "workflow:save-refined-workflow",
        conversationId,
      ),

    reset: (conversationId: string) =>
      electronAPI.ipcRenderer.invoke(
        "workflow:reset-refinement",
        conversationId,
      ),
  },

  // Monitor management functionality
  monitor: {
    create: (data: {
      url: string;
      goal?: string;
      frequency: "1h" | "2h" | "4h" | "6h";
    }) => electronAPI.ipcRenderer.invoke("monitor:create", data),

    pause: (id: string) =>
      electronAPI.ipcRenderer.invoke("monitor:pause", { id }),

    resume: (id: string) =>
      electronAPI.ipcRenderer.invoke("monitor:resume", { id }),

    delete: (id: string) =>
      electronAPI.ipcRenderer.invoke("monitor:delete", { id }),

    getAll: (filters?: { status?: "active" | "paused" | "error" }) =>
      electronAPI.ipcRenderer.invoke("monitor:get-all", filters),

    onStatusChanged: (callback: (monitor: unknown) => void) => {
      electronAPI.ipcRenderer.on("monitor:status-changed", (_, monitor) =>
        callback(monitor),
      );
    },

    removeStatusChangedListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("monitor:status-changed");
    },

    onAlert: (callback: (alert: unknown) => void) => {
      electronAPI.ipcRenderer.on("monitor:alert", (_, alert) =>
        callback(alert),
      );
    },

    removeAlertListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("monitor:alert");
    },
  },

  // Recording functionality (Story 1.11)
  recording: {
    start: (tabId: string) =>
      electronAPI.ipcRenderer.invoke("pattern:start-recording", { tabId }),

    stop: () => electronAPI.ipcRenderer.invoke("pattern:stop-recording"),

    // AC #9: Get action count before stopping
    getActionCount: () =>
      electronAPI.ipcRenderer.invoke("pattern:get-action-count"),

    save: (data: { name: string; description?: string; actions: unknown[] }) =>
      electronAPI.ipcRenderer.invoke("pattern:save-recording", data),

    onActionCaptured: (
      callback: (data: {
        tabId: string;
        actionCount: number;
        actionType: string;
      }) => void,
    ) => {
      electronAPI.ipcRenderer.on("recording:action-captured", (_, data) =>
        callback(data),
      );
    },

    removeActionCapturedListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("recording:action-captured");
    },

    onStatusChanged: (
      callback: (data: {
        status: string;
        tabId?: string;
        message?: string;
      }) => void,
    ) => {
      electronAPI.ipcRenderer.on("recording:status-changed", (_, data) =>
        callback(data),
      );
    },

    removeStatusChangedListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("recording:status-changed");
    },

    // Convenience method for generic event listening
    on: (
      event: "action-captured" | "status-changed",
      callback: (data: unknown) => void,
    ) => {
      const eventName =
        event === "action-captured"
          ? "recording:action-captured"
          : "recording:status-changed";
      electronAPI.ipcRenderer.on(eventName, (_, data) => callback(data));
    },

    removeListener: (event: "action-captured" | "status-changed") => {
      const eventName =
        event === "action-captured"
          ? "recording:action-captured"
          : "recording:status-changed";
      electronAPI.ipcRenderer.removeAllListeners(eventName);
    },
  },
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
  } catch (error) {
    log.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.sidebarAPI = sidebarAPI;
}
