import { app, BrowserWindow } from "electron";
import { electronApp } from "@electron-toolkit/utils";
import { Window } from "./Window";
import { AppMenu } from "./Menu";
import { EventManager } from "./EventManager";
import { DatabaseManager } from "./database/Database";
import { PreferencesStore } from "./store/PreferencesStore";
import log from "electron-log";

let mainWindow: Window | null = null;
let eventManager: EventManager | null = null;
let menu: AppMenu | null = null;
let database: DatabaseManager | null = null;

// Export database and preferences for use in other modules
export let db: DatabaseManager | null = null;
export let prefs: PreferencesStore | null = null;

const createWindow = (): Window => {
  const window = new Window();
  menu = new AppMenu(window);
  eventManager = new EventManager(window);
  return window;
};

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.electron");

  // Initialize database and preferences before creating window
  try {
    log.info("[App] Initializing database...");
    database = DatabaseManager.getInstance();
    db = database;
    await database.initialize();
    log.info("[App] Database initialized successfully");

    log.info("[App] Initializing preferences store...");
    prefs = PreferencesStore.getInstance();
    log.info("[App] Preferences store initialized successfully");
  } catch (error) {
    log.error("[App] Failed to initialize infrastructure:", error);
    // Continue anyway - UI can show error state
  }

  mainWindow = createWindow();

  app.on("activate", () => {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (eventManager) {
    eventManager.cleanup();
    eventManager = null;
  }

  // Clean up references
  if (mainWindow) {
    mainWindow = null;
  }
  if (menu) {
    menu = null;
  }

  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Cleanup database before app quits
app.on("before-quit", () => {
  if (database) {
    try {
      log.info("[App] Closing database connection...");
      database.close();
      database = null;
      db = null;
      log.info("[App] Database closed successfully");
    } catch (error) {
      log.error("[App] Failed to close database:", error);
    }
  }
});
