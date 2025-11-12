import { ipcMain, WebContents } from "electron";
import type { Window } from "./Window";
import { NotificationManager } from "./NotificationManager";
import {
  DismissNotificationSchema,
  GetNotificationsSchema,
} from "./schemas/notificationSchemas";
import { PatternManager } from "./PatternManager";
import {
  PatternTrackSchema,
  PatternGetAllSchema,
  SaveAutomationSchema,
  ExecuteAutomationSchema,
} from "./schemas/patternSchemas";
import { z } from "zod";

export class EventManager {
  private mainWindow: Window;
  private rateLimiters: Map<string, number[]> = new Map();

  constructor(mainWindow: Window) {
    this.mainWindow = mainWindow;
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // Tab management events
    this.handleTabEvents();

    // Sidebar events
    this.handleSidebarEvents();

    // Notification events
    this.handleNotificationEvents();

    // Pattern events
    this.handlePatternEvents();

    // Page content events
    this.handlePageContentEvents();

    // Dark mode events
    this.handleDarkModeEvents();

    // Debug events
    this.handleDebugEvents();
  }

  private handleTabEvents(): void {
    // Create new tab
    ipcMain.handle("create-tab", (_, url?: string) => {
      const newTab = this.mainWindow.createTab(url);
      return { id: newTab.id, title: newTab.title, url: newTab.url };
    });

    // Close tab
    ipcMain.handle("close-tab", (_, id: string) => {
      this.mainWindow.closeTab(id);
    });

    // Switch tab
    ipcMain.handle("switch-tab", (_, id: string) => {
      this.mainWindow.switchActiveTab(id);
    });

    // Get tabs
    ipcMain.handle("get-tabs", () => {
      const activeTabId = this.mainWindow.activeTab?.id;
      return this.mainWindow.allTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        url: tab.url,
        isActive: activeTabId === tab.id,
      }));
    });

    // Navigation (for compatibility with existing code)
    ipcMain.handle("navigate-to", (_, url: string) => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.loadURL(url);
      }
    });

    ipcMain.handle("navigate-tab", async (_, tabId: string, url: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        await tab.loadURL(url);
        return true;
      }
      return false;
    });

    ipcMain.handle("go-back", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goBack();
      }
    });

    ipcMain.handle("go-forward", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.goForward();
      }
    });

    ipcMain.handle("reload", () => {
      if (this.mainWindow.activeTab) {
        this.mainWindow.activeTab.reload();
      }
    });

    // Tab-specific navigation handlers
    ipcMain.handle("tab-go-back", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goBack();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-go-forward", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.goForward();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-reload", (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        tab.reload();
        return true;
      }
      return false;
    });

    ipcMain.handle("tab-screenshot", async (_, tabId: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        const image = await tab.screenshot();
        return image.toDataURL();
      }
      return null;
    });

    ipcMain.handle("tab-run-js", async (_, tabId: string, code: string) => {
      const tab = this.mainWindow.getTab(tabId);
      if (tab) {
        return await tab.runJs(code);
      }
      return null;
    });

    // Tab info
    ipcMain.handle("get-active-tab-info", () => {
      const activeTab = this.mainWindow.activeTab;
      if (activeTab) {
        return {
          id: activeTab.id,
          url: activeTab.url,
          title: activeTab.title,
          canGoBack: activeTab.webContents.canGoBack(),
          canGoForward: activeTab.webContents.canGoForward(),
        };
      }
      return null;
    });
  }

  private handleSidebarEvents(): void {
    // Toggle sidebar - always shows chat when opening
    ipcMain.handle("toggle-sidebar", () => {
      const wasVisible = this.mainWindow.sidebar.getIsVisible();
      this.mainWindow.sidebar.toggle();
      this.mainWindow.updateAllBounds();

      // If sidebar was just opened (transitioned from hidden to visible), show chat
      if (!wasVisible) {
        this.mainWindow.sidebar.view.webContents.send("show-chat");
      }
      return true;
    });

    // Show notifications - toggles view if sidebar already open
    ipcMain.handle("show-notifications", () => {
      const isVisible = this.mainWindow.sidebar.getIsVisible();

      if (!isVisible) {
        // Sidebar is closed - open it and show notifications
        this.mainWindow.sidebar.show();
        this.mainWindow.updateAllBounds();
        this.mainWindow.sidebar.view.webContents.send(
          "show-notification-panel",
        );
      } else {
        // Sidebar is already open - toggle between chat and notifications
        this.mainWindow.sidebar.view.webContents.send(
          "toggle-notification-view",
        );
      }
      return true;
    });

    // Chat message
    ipcMain.handle("sidebar-chat-message", async (_, request) => {
      // The LLMClient now handles getting the screenshot and context directly
      await this.mainWindow.sidebar.client.sendChatMessage(request);
    });

    // Clear chat
    ipcMain.handle("sidebar-clear-chat", () => {
      this.mainWindow.sidebar.client.clearMessages();
      return true;
    });

    // Get messages
    ipcMain.handle("sidebar-get-messages", () => {
      return this.mainWindow.sidebar.client.getMessages();
    });
  }

  private handleNotificationEvents(): void {
    const notificationManager = NotificationManager.getInstance();

    // Get all notifications (optionally filtered by type)
    ipcMain.handle("notification:get-all", async (_, input) => {
      try {
        const validInput = GetNotificationsSchema.parse(input || {});
        const notifications = await notificationManager.getNotifications(
          validInput.type,
        );
        return { success: true, data: notifications };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "NOTIF_FETCH_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });

    // Dismiss a notification
    ipcMain.handle("notification:dismiss", async (_, input) => {
      try {
        const validInput = DismissNotificationSchema.parse(input);
        await notificationManager.dismissNotification(
          validInput.notificationId,
        );
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "NOTIF_DISMISS_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });

    // Dismiss all notifications
    ipcMain.handle("notification:dismiss-all", async () => {
      try {
        await notificationManager.dismissAll();
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "NOTIF_DISMISS_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });

    // Get unread count
    ipcMain.handle("notification:get-unread-count", async () => {
      try {
        const count = await notificationManager.getUnreadCount();
        return { success: true, data: count };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "NOTIF_FETCH_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });

    // Test notification creator (for development/testing)
    ipcMain.handle("notification:create-test", async (_, input) => {
      try {
        const notification = await notificationManager.createNotification({
          type: input.type || "system",
          severity: input.severity || "info",
          title: input.title || "Test Notification",
          message: input.message || "This is a test notification",
          data: input.data,
        });

        // Broadcast to sidebar
        this.broadcastNotification(notification);

        return { success: true, data: notification };
      } catch (error) {
        return {
          success: false,
          error: {
            code: "NOTIF_CREATE_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });
  }

  private handlePatternEvents(): void {
    const patternManager = PatternManager.getInstance();

    // Track pattern
    ipcMain.handle("pattern:track", async (_, data) => {
      try {
        // Rate limiting
        if (!this.checkRateLimit("pattern:track", 50)) {
          return {
            success: false,
            error: {
              code: "RATE_LIMIT",
              message: "Too many requests",
            },
          };
        }

        // Zod validation
        const validated = PatternTrackSchema.parse(data);

        // Call PatternManager
        return await patternManager.trackPattern(validated);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: error.issues[0].message,
            },
          };
        }
        return {
          success: false,
          error: {
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });

    // Get all patterns
    ipcMain.handle("pattern:get-all", async (_, filters) => {
      try {
        // Rate limiting
        if (!this.checkRateLimit("pattern:get-all", 50)) {
          return {
            success: false,
            error: {
              code: "RATE_LIMIT",
              message: "Too many requests",
            },
          };
        }

        // Zod validation (optional filters)
        const validated = filters
          ? PatternGetAllSchema.parse(filters)
          : undefined;

        // Call PatternManager
        return await patternManager.getAllPatterns(validated);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: error.issues[0].message,
            },
          };
        }
        return {
          success: false,
          error: {
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });

    // Save automation
    ipcMain.handle("pattern:save-automation", async (_, data) => {
      try {
        // Rate limiting
        if (!this.checkRateLimit("pattern:save-automation", 50)) {
          return {
            success: false,
            error: {
              code: "RATE_LIMIT",
              message: "Too many requests",
            },
          };
        }

        // Zod validation
        const validated = SaveAutomationSchema.parse(data);

        // Call PatternManager
        return await patternManager.saveAutomation(validated);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: error.issues[0].message,
            },
          };
        }
        return {
          success: false,
          error: {
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });

    // Execute automation
    ipcMain.handle("pattern:execute", async (_, data) => {
      try {
        // Rate limiting
        if (!this.checkRateLimit("pattern:execute", 50)) {
          return {
            success: false,
            error: {
              code: "RATE_LIMIT",
              message: "Too many requests",
            },
          };
        }

        // Zod validation
        const validated = ExecuteAutomationSchema.parse(data);

        // Call PatternManager
        return await patternManager.executeAutomation(validated);
      } catch (error) {
        if (error instanceof z.ZodError) {
          return {
            success: false,
            error: {
              code: "VALIDATION_ERROR",
              message: error.issues[0].message,
            },
          };
        }
        return {
          success: false,
          error: {
            code: "UNKNOWN_ERROR",
            message: error instanceof Error ? error.message : "Unknown error",
          },
        };
      }
    });
  }

  private handlePageContentEvents(): void {
    // Get page content
    ipcMain.handle("get-page-content", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabHtml();
        } catch (error) {
          console.error("Error getting page content:", error);
          return null;
        }
      }
      return null;
    });

    // Get page text
    ipcMain.handle("get-page-text", async () => {
      if (this.mainWindow.activeTab) {
        try {
          return await this.mainWindow.activeTab.getTabText();
        } catch (error) {
          console.error("Error getting page text:", error);
          return null;
        }
      }
      return null;
    });

    // Get current URL
    ipcMain.handle("get-current-url", () => {
      if (this.mainWindow.activeTab) {
        return this.mainWindow.activeTab.url;
      }
      return null;
    });
  }

  private handleDarkModeEvents(): void {
    // Dark mode broadcasting
    ipcMain.on("dark-mode-changed", (event, isDarkMode) => {
      this.broadcastDarkMode(event.sender, isDarkMode);
    });
  }

  private handleDebugEvents(): void {
    // Ping test
    ipcMain.on("ping", () => console.log("pong"));
  }

  private broadcastDarkMode(sender: WebContents, isDarkMode: boolean): void {
    // Send to topbar
    if (this.mainWindow.topBar.view.webContents !== sender) {
      this.mainWindow.topBar.view.webContents.send(
        "dark-mode-updated",
        isDarkMode,
      );
    }

    // Send to sidebar
    if (this.mainWindow.sidebar.view.webContents !== sender) {
      this.mainWindow.sidebar.view.webContents.send(
        "dark-mode-updated",
        isDarkMode,
      );
    }

    // Send to all tabs
    this.mainWindow.allTabs.forEach((tab) => {
      if (tab.webContents !== sender) {
        tab.webContents.send("dark-mode-updated", isDarkMode);
      }
    });
  }

  // Rate limiting helper
  private checkRateLimit(channel: string, maxPerSecond: number): boolean {
    const now = Date.now();
    const calls = this.rateLimiters.get(channel) || [];
    const recentCalls = calls.filter((time) => now - time < 1000);

    if (recentCalls.length >= maxPerSecond) {
      return false; // Rate limit exceeded
    }

    recentCalls.push(now);
    this.rateLimiters.set(channel, recentCalls);
    return true;
  }

  // Broadcast notification to sidebar
  public broadcastNotification(notification: {
    id: string;
    type: string;
    severity: string;
    title: string;
    message: string;
    created_at: number;
  }): void {
    this.mainWindow.sidebar.view.webContents.send(
      "notification:show",
      notification,
    );
  }

  // Broadcast pattern detected event to sidebar
  public broadcastPatternDetected(pattern: {
    id: string;
    type: string;
    pattern_data: string;
    confidence: number;
    detected_at: number;
  }): void {
    // Security check: validate WebContents ID before sending
    if (this.mainWindow.sidebar.view.webContents) {
      this.mainWindow.sidebar.view.webContents.send(
        "pattern:detected",
        pattern,
      );
    }
  }

  // Broadcast automation completed event to sidebar
  public broadcastAutomationCompleted(result: {
    automation_id: string;
    success: boolean;
    result: unknown;
  }): void {
    // Security check: validate WebContents ID before sending
    if (this.mainWindow.sidebar.view.webContents) {
      this.mainWindow.sidebar.view.webContents.send(
        "pattern:automation-completed",
        result,
      );
    }
  }

  // Clean up event listeners
  public cleanup(): void {
    ipcMain.removeAllListeners();
  }
}
