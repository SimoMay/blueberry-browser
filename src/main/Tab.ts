import { NativeImage, WebContents, WebContentsView } from "electron";
import log from "electron-log";
import { PatternManager } from "./PatternManager";

export class Tab {
  private webContentsView: WebContentsView;
  private _id: string;
  private _title: string;
  private _url: string;
  private _isVisible: boolean = false;
  private formSubmissionTimestamps: number[] = []; // Track timestamps for rate limiting

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
    // Handle SSL certificate errors (suppress harmless warnings in dev)
    this.webContentsView.webContents.session.setCertificateVerifyProc(
      (request, callback) => {
        const { hostname, verificationResult, errorCode } = request;

        // In development, log but allow all certificates
        // In production, you may want stricter validation
        if (errorCode !== 0) {
          log.warn("[Tab] Certificate verification warning:", {
            hostname,
            verificationResult,
            errorCode,
          });
        }

        // Accept the certificate (prevents SSL errors in logs)
        // For production, you might want: callback(errorCode === 0 ? 0 : -2)
        callback(0);
      },
    );

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

    // Inject form tracking script on page load
    this.webContentsView.webContents.on("did-finish-load", async () => {
      await this.injectFormTrackingScript();
    });

    // Listen for console messages from injected script (form tracking workaround for sandbox)
    this.webContentsView.webContents.on(
      "console-message",
      async (_, _level, message) => {
        if (message.startsWith("__BLUEBERRY_FORM_SUBMIT__")) {
          try {
            const jsonData = message.substring(
              "__BLUEBERRY_FORM_SUBMIT__".length + 1,
            ); // +1 for space
            const formData = JSON.parse(jsonData);

            // SECURITY: Validate tabId matches current tab (prevent cross-tab injection)
            if (formData.tabId !== this._id) {
              log.warn(
                "[Tab] Form submission tabId mismatch - potential injection attempt",
                {
                  expected: this._id,
                  received: formData.tabId,
                },
              );
              return;
            }

            // SECURITY: Validate timestamp freshness (reject old messages)
            const messageAge = Date.now() - formData.timestamp;
            if (messageAge > 5000) {
              // 5 seconds max age
              log.warn(
                "[Tab] Form submission timestamp too old - rejecting stale message",
                {
                  ageMs: messageAge,
                  maxAgeMs: 5000,
                },
              );
              return;
            }
            if (messageAge < 0) {
              // Future timestamp (clock skew or manipulation)
              log.warn(
                "[Tab] Form submission timestamp in future - rejecting",
                {
                  ageMs: messageAge,
                },
              );
              return;
            }

            // SECURITY: Rate limiting per tab (max 10 submissions per minute)
            const now = Date.now();
            const oneMinuteAgo = now - 60000;

            // Clean up old timestamps
            this.formSubmissionTimestamps =
              this.formSubmissionTimestamps.filter((ts) => ts > oneMinuteAgo);

            // Check rate limit
            if (this.formSubmissionTimestamps.length >= 10) {
              log.warn(
                "[Tab] Form submission rate limit exceeded - rejecting",
                {
                  submissionsInLastMinute: this.formSubmissionTimestamps.length,
                  maxPerMinute: 10,
                },
              );
              return;
            }

            // Add current timestamp to tracking
            this.formSubmissionTimestamps.push(now);

            const patternManager = PatternManager.getInstance();
            await patternManager.trackFormSubmission(formData);

            log.info("[Tab] Form submission tracked successfully");
          } catch (error) {
            log.error("[Tab] Form submission tracking error:", error);
          }
        }
      },
    );
  }

  /**
   * Inject form tracking script into page context
   * Captures form submissions and sends data to main process for pattern tracking
   */
  private async injectFormTrackingScript(): Promise<void> {
    try {
      await this.webContentsView.webContents.executeJavaScript(`
        (function() {
          // Prevent double injection
          if (window.__blueberryFormTrackerInjected) return;
          window.__blueberryFormTrackerInjected = true;

          // Sensitive field patterns for filtering
          const SENSITIVE_PATTERNS = [
            /password/i,
            /passwd/i,
            /pwd/i,
            /card/i,
            /cvv/i,
            /cvc/i,
            /ssn/i,
            /security/i,
            /secret/i
          ];

          // Check if field is sensitive
          function isSensitiveField(fieldName, fieldType) {
            if (fieldType === 'password') return true;
            return SENSITIVE_PATTERNS.some(pattern => pattern.test(fieldName));
          }

          // Get CSS selector for form element
          function getFormSelector(form) {
            if (form.id) return '#' + form.id;
            if (form.name) return 'form[name="' + form.name + '"]';

            // Fallback: nth-of-type selector
            const forms = document.querySelectorAll('form');
            const index = Array.from(forms).indexOf(form);
            return 'form:nth-of-type(' + (index + 1) + ')';
          }

          // Anonymize field value to pattern
          function anonymizeValue(value) {
            if (!value) return 'text_format';

            // Email pattern
            if (/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$/.test(value)) {
              return 'email_format';
            }

            // Name pattern (letters and spaces only)
            if (/^[a-zA-Z\\s]+$/.test(value) && value.length > 2) {
              return 'name_format';
            }

            // Phone pattern (digits, spaces, dashes, parentheses, plus)
            if (/^[\\d\\s\\-()+]+$/.test(value) && value.replace(/\\D/g, '').length >= 7) {
              return 'phone_format';
            }

            // Number pattern (pure digits)
            if (/^\\d+$/.test(value)) {
              return 'number_format';
            }

            // Default: text
            return 'text_format';
          }

          // Extract form fields (excluding sensitive fields)
          function extractFormFields(form) {
            const fields = [];
            const inputs = form.querySelectorAll('input, textarea, select');

            inputs.forEach(input => {
              const fieldName = input.name || input.id || '';
              const fieldType = input.type || 'text';
              const fieldValue = input.value || '';

              // Skip if no name/id or if sensitive
              if (!fieldName || isSensitiveField(fieldName, fieldType)) {
                return;
              }

              // Skip empty fields
              if (!fieldValue) {
                return;
              }

              // Add field with anonymized value pattern
              fields.push({
                name: fieldName,
                type: fieldType,
                valuePattern: anonymizeValue(fieldValue)
              });
            });

            return fields;
          }

          // Listen for form submissions
          document.addEventListener('submit', (event) => {
            try {
              const form = event.target;
              const formSelector = getFormSelector(form);
              const fields = extractFormFields(form);

              // Only track if we have fields to track
              if (fields.length === 0) {
                return;
              }

              // Send form data to main process
              const formData = {
                domain: window.location.hostname,
                formSelector: formSelector,
                fields: fields,
                timestamp: Date.now(),
                tabId: '${this._id}'
              };

              // Use postMessage to send to main process (works in sandboxed context)
              // Main process will listen via 'ipc-message' event
              window.postMessage({
                type: 'blueberry-form-submit',
                channel: 'form-submit-tracked',
                data: formData
              }, '*');
            } catch (error) {
              console.error('[Blueberry] Form tracking error:', error);
            }
          }, true); // Use capture phase

        })();
      `);

      // Set up listener for postMessage from the injected script
      await this.webContentsView.webContents.executeJavaScript(`
        window.addEventListener('message', async (event) => {
          if (event.data && event.data.type === 'blueberry-form-submit') {
            // Forward to main process via console API workaround
            // We'll intercept console messages in main process
            console.log('__BLUEBERRY_FORM_SUBMIT__', JSON.stringify(event.data.data));
          }
        });
      `);

      log.info("[Tab] Form tracking script injected successfully");
    } catch (error) {
      log.error("[Tab] Form tracking script injection error:", error);
    }
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
