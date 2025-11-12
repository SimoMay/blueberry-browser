import ElectronStore from "electron-store";
import log from "electron-log";

// Type helper to properly expose Conf methods on ElectronStore
// ElectronStore extends Conf but TypeScript doesn't always see the inherited methods
// We manually define the interface instead of importing Conf to avoid module resolution issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface ConfMethods<T extends Record<string, any>> {
  get<K extends keyof T>(key: K): T[K];
  set<K extends keyof T>(key: K, value: T[K]): void;
  has<K extends keyof T>(key: K): boolean;
  delete<K extends keyof T>(key: K): void;
  reset(...keys: Array<keyof T>): void;
  clear(): void;
  readonly path: string;
  store: T;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StoreWithMethods<T extends Record<string, any>> = ElectronStore<T> &
  ConfMethods<T>;

/**
 * User preferences schema
 * Define all application preferences with types
 */
export interface PreferencesSchema {
  // LLM Settings
  llm: {
    provider: "openai" | "anthropic";
    model: string;
    apiKey?: string; // Encrypted, should not be stored here - use env vars
  };
  // UI Preferences
  ui: {
    theme: "light" | "dark" | "system";
    sidebarWidth: number;
    fontSize: number;
  };
  // Pattern Detection Settings
  patterns: {
    enabled: boolean;
    autoLearnEnabled: boolean;
    confidenceThreshold: number;
    cleanupDays: number;
  };
  // Monitor Settings
  monitors: {
    enabled: boolean;
    defaultCheckInterval: number; // minutes
    notificationsEnabled: boolean;
  };
  // Privacy Settings
  privacy: {
    clearHistoryOnExit: boolean;
    disableTelemetry: boolean;
  };
}

/**
 * Default preferences values
 */
const defaultPreferences: PreferencesSchema = {
  llm: {
    provider: "openai",
    model: "gpt-4o-mini",
  },
  ui: {
    theme: "system",
    sidebarWidth: 400,
    fontSize: 14,
  },
  patterns: {
    enabled: true,
    autoLearnEnabled: false,
    confidenceThreshold: 0.7,
    cleanupDays: 30,
  },
  monitors: {
    enabled: true,
    defaultCheckInterval: 60,
    notificationsEnabled: true,
  },
  privacy: {
    clearHistoryOnExit: false,
    disableTelemetry: true,
  },
};

/**
 * Preferences store manager with encryption
 *
 * Wraps electron-store with type safety and encryption for sensitive data
 * Uses electron-store's built-in encryption for the entire store
 */
export class PreferencesStore {
  private static instance: PreferencesStore | null = null;
  private store: StoreWithMethods<PreferencesSchema>;

  /**
   * Private constructor for singleton pattern
   */
  private constructor() {
    try {
      // Cast to StoreWithMethods to expose Conf methods that ElectronStore inherits
      this.store = new ElectronStore<PreferencesSchema>({
        name: "preferences",
        defaults: defaultPreferences,
        encryptionKey: "blueberry-browser-preferences-encryption", // In production, use crypto.randomBytes
        clearInvalidConfig: true,
        schema: {
          llm: {
            type: "object",
            properties: {
              provider: { type: "string", enum: ["openai", "anthropic"] },
              model: { type: "string" },
              apiKey: { type: "string" },
            },
            required: ["provider", "model"],
          },
          ui: {
            type: "object",
            properties: {
              theme: { type: "string", enum: ["light", "dark", "system"] },
              sidebarWidth: { type: "number", minimum: 200, maximum: 800 },
              fontSize: { type: "number", minimum: 10, maximum: 24 },
            },
            required: ["theme", "sidebarWidth", "fontSize"],
          },
          patterns: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              autoLearnEnabled: { type: "boolean" },
              confidenceThreshold: { type: "number", minimum: 0, maximum: 1 },
              cleanupDays: { type: "number", minimum: 1 },
            },
            required: [
              "enabled",
              "autoLearnEnabled",
              "confidenceThreshold",
              "cleanupDays",
            ],
          },
          monitors: {
            type: "object",
            properties: {
              enabled: { type: "boolean" },
              defaultCheckInterval: { type: "number", minimum: 1 },
              notificationsEnabled: { type: "boolean" },
            },
            required: [
              "enabled",
              "defaultCheckInterval",
              "notificationsEnabled",
            ],
          },
          privacy: {
            type: "object",
            properties: {
              clearHistoryOnExit: { type: "boolean" },
              disableTelemetry: { type: "boolean" },
            },
            required: ["clearHistoryOnExit", "disableTelemetry"],
          },
        },
      }) as StoreWithMethods<PreferencesSchema>;

      log.info("[PreferencesStore] Preferences store initialized");
    } catch (error) {
      log.error("[PreferencesStore] Initialization failed:", error);
      throw {
        code: "STORE_INIT_ERROR",
        message:
          error instanceof Error
            ? error.message
            : "Store initialization failed",
      };
    }
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): PreferencesStore {
    if (!PreferencesStore.instance) {
      PreferencesStore.instance = new PreferencesStore();
    }
    return PreferencesStore.instance;
  }

  /**
   * Get a preference value by key path
   * Example: get('llm.provider') or get('ui')
   */
  public get<K extends keyof PreferencesSchema>(key: K): PreferencesSchema[K];
  public get<
    K extends keyof PreferencesSchema,
    SK extends keyof PreferencesSchema[K],
  >(key: `${K}.${SK & string}`): PreferencesSchema[K][SK];
  public get(key: string): unknown {
    try {
      return this.store.get(key as keyof PreferencesSchema);
    } catch (error) {
      log.error("[PreferencesStore] Get failed:", error);
      throw {
        code: "STORE_GET_ERROR",
        message: error instanceof Error ? error.message : "Get failed",
      };
    }
  }

  /**
   * Set a preference value by key path
   * Example: set('llm.provider', 'anthropic')
   */
  public set<K extends keyof PreferencesSchema>(
    key: K,
    value: PreferencesSchema[K],
  ): void;
  public set<
    K extends keyof PreferencesSchema,
    SK extends keyof PreferencesSchema[K],
  >(key: `${K}.${SK & string}`, value: PreferencesSchema[K][SK]): void;
  public set(key: string, value: unknown): void {
    try {
      this.store.set(key as keyof PreferencesSchema, value);
      log.debug("[PreferencesStore] Set:", key);
    } catch (error) {
      log.error("[PreferencesStore] Set failed:", error);
      throw {
        code: "STORE_SET_ERROR",
        message: error instanceof Error ? error.message : "Set failed",
      };
    }
  }

  /**
   * Check if a preference key exists
   */
  public has(key: string): boolean {
    try {
      return this.store.has(key as keyof PreferencesSchema);
    } catch (error) {
      log.error("[PreferencesStore] Has check failed:", error);
      return false;
    }
  }

  /**
   * Delete a preference key
   */
  public delete(key: string): void {
    try {
      this.store.delete(key as keyof PreferencesSchema);
      log.debug("[PreferencesStore] Deleted:", key);
    } catch (error) {
      log.error("[PreferencesStore] Delete failed:", error);
      throw {
        code: "STORE_DELETE_ERROR",
        message: error instanceof Error ? error.message : "Delete failed",
      };
    }
  }

  /**
   * Reset a preference to its default value
   */
  public reset(key: string): void {
    try {
      this.store.reset(key as keyof PreferencesSchema);
      log.debug("[PreferencesStore] Reset:", key);
    } catch (error) {
      log.error("[PreferencesStore] Reset failed:", error);
      throw {
        code: "STORE_RESET_ERROR",
        message: error instanceof Error ? error.message : "Reset failed",
      };
    }
  }

  /**
   * Clear all preferences (reset to defaults)
   */
  public clear(): void {
    try {
      this.store.clear();
      log.info("[PreferencesStore] All preferences cleared");
    } catch (error) {
      log.error("[PreferencesStore] Clear failed:", error);
      throw {
        code: "STORE_CLEAR_ERROR",
        message: error instanceof Error ? error.message : "Clear failed",
      };
    }
  }

  /**
   * Get the file path of the preferences store
   */
  public getPath(): string {
    return this.store.path;
  }

  /**
   * Get all preferences
   */
  public getAll(): PreferencesSchema {
    try {
      return this.store.store;
    } catch (error) {
      log.error("[PreferencesStore] GetAll failed:", error);
      throw {
        code: "STORE_GETALL_ERROR",
        message: error instanceof Error ? error.message : "GetAll failed",
      };
    }
  }
}
