import { contextBridge } from "electron";
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
    track: (data: {
      type: "navigation" | "form" | "copy-paste";
      pattern_data: string;
      confidence: number;
    }) => electronAPI.ipcRenderer.invoke("pattern:track", data),

    getAll: (filters?: { type?: "navigation" | "form" | "copy-paste" }) =>
      electronAPI.ipcRenderer.invoke("pattern:get-all", filters),

    saveAutomation: (data: {
      pattern_id: string;
      name: string;
      description?: string;
    }) => electronAPI.ipcRenderer.invoke("pattern:save-automation", data),

    dismiss: (data: { patternId: string }) =>
      electronAPI.ipcRenderer.invoke("pattern:dismiss", data),

    executeAutomation: (automation_id: string) =>
      electronAPI.ipcRenderer.invoke("pattern:execute", { automation_id }),

    onDetected: (callback: (pattern: unknown) => void) => {
      electronAPI.ipcRenderer.on("pattern:detected", (_, pattern) =>
        callback(pattern),
      );
    },

    removeDetectedListener: () => {
      electronAPI.ipcRenderer.removeAllListeners("pattern:detected");
    },

    onAutomationCompleted: (callback: (result: unknown) => void) => {
      electronAPI.ipcRenderer.on("pattern:automation-completed", (_, result) =>
        callback(result),
      );
    },

    removeAutomationCompletedListener: () => {
      electronAPI.ipcRenderer.removeAllListeners(
        "pattern:automation-completed",
      );
    },
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
};

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld("electron", electronAPI);
    contextBridge.exposeInMainWorld("sidebarAPI", sidebarAPI);
  } catch (error) {
    console.error(error);
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI;
  // @ts-ignore (define in dts)
  window.sidebarAPI = sidebarAPI;
}
