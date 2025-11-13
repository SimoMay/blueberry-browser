import { ElectronAPI } from "@electron-toolkit/preload";

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
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
}

interface TabInfo {
  id: string;
  title: string;
  url: string;
  isActive: boolean;
}

interface Notification {
  id: string;
  type: "pattern" | "monitor" | "system";
  severity: "info" | "warning" | "error";
  title: string;
  message: string;
  data?: unknown;
  created_at: number;
  dismissed_at: number | null;
}

interface NotificationAPIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface Pattern {
  id: string;
  type: "navigation" | "form" | "copy-paste";
  pattern_data: string;
  confidence: number;
  created_at: number;
}

interface Automation {
  id: string;
  pattern_id: string;
  name: string;
  description?: string;
  created_at: number;
}

interface PatternAPIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface Monitor {
  id: string;
  url: string;
  goal?: string;
  frequency: "1h" | "2h" | "4h" | "6h";
  status: "active" | "paused" | "error";
  last_check?: number;
  created_at: number;
  updated_at: number;
}

interface MonitorCreateInput {
  url: string;
  goal?: string;
  frequency: "1h" | "2h" | "4h" | "6h";
}

interface MonitorAPIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

interface SidebarAPI {
  // Chat functionality
  sendChatMessage: (request: Partial<ChatRequest>) => Promise<void>;
  clearChat: () => Promise<boolean>;
  getMessages: () => Promise<ChatMessage[]>;
  onChatResponse: (callback: (data: ChatResponse) => void) => void;
  onMessagesUpdated: (callback: (messages: ChatMessage[]) => void) => void;
  removeChatResponseListener: () => void;
  removeMessagesUpdatedListener: () => void;

  // Page content access
  getPageContent: () => Promise<string | null>;
  getPageText: () => Promise<string | null>;
  getCurrentUrl: () => Promise<string | null>;

  // Tab information
  getActiveTabInfo: () => Promise<TabInfo | null>;

  // Notification functionality
  notifications: {
    onReceive: (callback: (notification: Notification) => void) => void;
    removeReceiveListener: () => void;
    onShowPanel: (callback: () => void) => void;
    removeShowPanelListener: () => void;
    onShowChat: (callback: () => void) => void;
    removeShowChatListener: () => void;
    onToggleView: (callback: () => void) => void;
    removeToggleViewListener: () => void;
    getAll: (type?: string) => Promise<NotificationAPIResponse<Notification[]>>;
    dismiss: (notificationId: string) => Promise<NotificationAPIResponse>;
    dismissAll: () => Promise<NotificationAPIResponse>;
    getUnreadCount: () => Promise<NotificationAPIResponse<number>>;
    createTest: (input?: {
      type?: string;
      severity?: string;
      title?: string;
      message?: string;
    }) => Promise<NotificationAPIResponse<Notification>>;
  };

  // Pattern detection functionality
  pattern: {
    track: (data: {
      type: "navigation" | "form" | "copy-paste";
      pattern_data: string;
      confidence: number;
    }) => Promise<PatternAPIResponse<Pattern>>;
    getAll: (filters?: {
      type?: "navigation" | "form" | "copy-paste";
    }) => Promise<PatternAPIResponse<Pattern[]>>;
    saveAutomation: (data: {
      pattern_id: string;
      name: string;
      description?: string;
    }) => Promise<PatternAPIResponse<Automation>>;
    dismiss: (data: { patternId: string }) => Promise<PatternAPIResponse>;
    executeAutomation: (
      automation_id: string,
    ) => Promise<PatternAPIResponse<{ execution_result: string }>>;
    onDetected: (callback: (pattern: Pattern) => void) => void;
    removeDetectedListener: () => void;
    onAutomationCompleted: (
      callback: (result: {
        automation_id: string;
        success: boolean;
        result: unknown;
      }) => void,
    ) => void;
    removeAutomationCompletedListener: () => void;
  };

  // Monitor management functionality
  monitor: {
    create: (data: MonitorCreateInput) => Promise<MonitorAPIResponse<Monitor>>;
    pause: (id: string) => Promise<MonitorAPIResponse<Monitor>>;
    resume: (id: string) => Promise<MonitorAPIResponse<Monitor>>;
    delete: (id: string) => Promise<MonitorAPIResponse<{ id: string }>>;
    getAll: (filters?: {
      status?: "active" | "paused" | "error";
    }) => Promise<MonitorAPIResponse<Monitor[]>>;
    onStatusChanged: (callback: (monitor: Monitor) => void) => void;
    removeStatusChangedListener: () => void;
    onAlert: (
      callback: (alert: {
        monitor_id: string;
        url: string;
        change_summary: string;
        severity: string;
        created_at: number;
      }) => void,
    ) => void;
    removeAlertListener: () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    sidebarAPI: SidebarAPI;
  }
}
