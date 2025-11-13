import { NativeImage, WebContents, WebContentsView } from "electron";
import log from "electron-log";
import { PatternManager } from "./PatternManager";

export class Tab {
  private webContentsView: WebContentsView;
  private _id: string;
  private _title: string;
  private _url: string;
  private _isVisible: boolean = false;

  constructor(id: string, url: string = "https://www.google.com") {
    this._id = id;
    this._url = url;
    this._title = "New Tab";

    // Create the WebContentsView for web content only
    this.webContentsView = new WebContentsView({
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
      },
    });

    // Set up event listeners
    this.setupEventListeners();

    // Load the initial URL
    this.loadURL(url);
  }

  private setupEventListeners(): void {
    // Update title when page title changes
    this.webContentsView.webContents.on("page-title-updated", (_, title) => {
      this._title = title;
    });

    // Update URL when navigation occurs
    this.webContentsView.webContents.on("did-navigate", async (_, url) => {
      this._url = url;

      // Track navigation pattern
      const timestamp = Date.now();
      try {
        const patternManager = PatternManager.getInstance();
        await patternManager.trackNavigation({
          url,
          tabId: this._id,
          timestamp,
          eventType: "did-navigate",
        });
      } catch (error) {
        log.error("[Tab] Navigation tracking error:", error);
      }
    });

    this.webContentsView.webContents.on(
      "did-navigate-in-page",
      async (_, url) => {
        this._url = url;

        // Track in-page navigation pattern (SPA transitions)
        const timestamp = Date.now();
        try {
          const patternManager = PatternManager.getInstance();
          await patternManager.trackNavigation({
            url,
            tabId: this._id,
            timestamp,
            eventType: "did-navigate-in-page",
          });
        } catch (error) {
          log.error("[Tab] In-page navigation tracking error:", error);
        }
      },
    );
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get title(): string {
    return this._title;
  }

  get url(): string {
    return this._url;
  }

  get isVisible(): boolean {
    return this._isVisible;
  }

  get webContents(): WebContents {
    return this.webContentsView.webContents;
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  // Public methods
  show(): void {
    this._isVisible = true;
    this.webContentsView.setVisible(true);
  }

  hide(): void {
    this._isVisible = false;
    this.webContentsView.setVisible(false);
  }

  async screenshot(): Promise<NativeImage> {
    return await this.webContentsView.webContents.capturePage();
  }

  async runJs(code: string): Promise<unknown> {
    return await this.webContentsView.webContents.executeJavaScript(code);
  }

  async getTabHtml(): Promise<string> {
    return (await this.runJs(
      "return document.documentElement.outerHTML",
    )) as string;
  }

  async getTabText(): Promise<string> {
    return (await this.runJs(
      "return document.documentElement.innerText",
    )) as string;
  }

  loadURL(url: string): Promise<void> {
    this._url = url;
    return this.webContentsView.webContents.loadURL(url);
  }

  goBack(): void {
    if (this.webContentsView.webContents.navigationHistory.canGoBack()) {
      this.webContentsView.webContents.navigationHistory.goBack();
    }
  }

  goForward(): void {
    if (this.webContentsView.webContents.navigationHistory.canGoForward()) {
      this.webContentsView.webContents.navigationHistory.goForward();
    }
  }

  reload(): void {
    this.webContentsView.webContents.reload();
  }

  stop(): void {
    this.webContentsView.webContents.stop();
  }

  destroy(): void {
    this.webContentsView.webContents.close();
  }
}
