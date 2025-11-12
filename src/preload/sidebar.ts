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
