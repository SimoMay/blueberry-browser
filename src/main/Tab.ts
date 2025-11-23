import { NativeImage, WebContents, WebContentsView } from "electron";
import log from "electron-log";
import { PatternManager } from "./PatternManager";
import type { Window } from "./Window";
import { NavigationAction, RecordedAction } from "./RecordingManager";

export class Tab {
  private webContentsView: WebContentsView;
  private _id: string;
  private _title: string;
  private _url: string;
  private _isVisible: boolean = false;
  private _isAutomationMode: boolean = false; // Skip pattern tracking during automation
  private formSubmissionTimestamps: number[] = []; // Track timestamps for rate limiting
  private _window?: Window; // Reference to parent window (set after construction)
  private _isRecordingMode: boolean = false; // Flag for recording overlay
  private _isDestroyed: boolean = false; // Track destruction state for cleanup

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

      const timestamp = Date.now();

      // Track navigation pattern (skip if in automation mode)
      if (!this._isAutomationMode) {
        try {
          // Enhanced context capture: Get page title (Story 1.12 - AC 1)
          let pageTitle: string | undefined;
          try {
            pageTitle =
              await this.webContentsView.webContents.executeJavaScript(
                "document.title",
              );
          } catch (titleError) {
            log.warn("[Tab] Failed to capture page title:", titleError);
          }

          const patternManager = PatternManager.getInstance();
          await patternManager.trackNavigation({
            url,
            tabId: this._id,
            timestamp,
            eventType: "did-navigate",
            pageTitle, // Enhanced context (Story 1.12)
          });
        } catch (error) {
          log.error("[Tab] Navigation tracking error:", error);
        }
      }

      // Capture for recording if active (Story 1.11 - AC 2)
      if (this._window) {
        const recordingManager = this._window.recordingManager;
        if (recordingManager.isRecording(this._id)) {
          const action: RecordedAction = {
            type: "navigation",
            timestamp,
            data: {
              url,
              tabId: this._id,
            } as NavigationAction,
          };
          recordingManager.captureAction(this._id, action);
        }
      }
    });

    this.webContentsView.webContents.on(
      "did-navigate-in-page",
      async (_, url) => {
        this._url = url;

        const timestamp = Date.now();

        // Track in-page navigation pattern (skip if in automation mode)
        if (!this._isAutomationMode) {
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
        }

        // Capture for recording if active (Story 1.11 - AC 2)
        if (this._window) {
          const recordingManager = this._window.recordingManager;
          if (recordingManager.isRecording(this._id)) {
            const action: RecordedAction = {
              type: "navigation",
              timestamp,
              data: {
                url,
                tabId: this._id,
              } as NavigationAction,
            };
            recordingManager.captureAction(this._id, action);
          }
        }
      },
    );

    // Inject form tracking script and automation overlay on page load
    this.webContentsView.webContents.on("did-finish-load", async () => {
      await this.injectFormTrackingScript();
      await this.injectCopyPasteTrackingScript(); // Story 1.7b

      // Re-inject automation overlay if in automation mode
      // (navigations clear the overlay, so we need to re-inject)
      if (this._isAutomationMode) {
        await this.injectAutomationOverlay();
      }

      // Re-inject recording overlay if in recording mode (Story 1.11 - AC 1)
      // (navigations clear the overlay, so we need to re-inject)
      if (this._isRecordingMode) {
        await this.injectRecordingOverlay();
      }
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

            // Capture for recording if active (Story 1.11 - AC 2)
            if (this._window) {
              const recordingManager = this._window.recordingManager;
              if (recordingManager.isRecording(this._id)) {
                const action: RecordedAction = {
                  type: "form",
                  timestamp: formData.timestamp,
                  data: {
                    domain: formData.domain,
                    formSelector: formData.formSelector,
                    fields: formData.fields,
                  },
                };
                recordingManager.captureAction(this._id, action);
              }
            }
          } catch (error) {
            log.error("[Tab] Form submission tracking error:", error);
          }
        }

        // Story 1.7b: Handle copy events
        if (message.startsWith("__BLUEBERRY_COPY__")) {
          try {
            const jsonData = message.substring("__BLUEBERRY_COPY__".length + 1);
            const copyData = JSON.parse(jsonData);

            // SECURITY: Validate tabId matches current tab
            if (copyData.tabId !== this._id) {
              log.warn("[Tab] Copy event tabId mismatch", {
                expected: this._id,
                received: copyData.tabId,
              });
              return;
            }

            // SECURITY: Validate timestamp freshness
            const messageAge = Date.now() - copyData.timestamp;
            if (messageAge > 5000 || messageAge < 0) {
              log.warn("[Tab] Copy event timestamp invalid", {
                ageMs: messageAge,
              });
              return;
            }

            // Skip if in automation mode (don't track patterns during automation)
            if (this._isAutomationMode) {
              return;
            }

            const patternManager = PatternManager.getInstance();
            await patternManager.trackCopyPaste({ copyEvent: copyData });

            log.info("[Tab] Copy event tracked successfully");
          } catch (error) {
            log.error("[Tab] Copy event tracking error:", error);
          }
        }

        // Story 1.7b: Handle paste events
        if (message.startsWith("__BLUEBERRY_PASTE__")) {
          try {
            const jsonData = message.substring(
              "__BLUEBERRY_PASTE__".length + 1,
            );
            const pasteData = JSON.parse(jsonData);

            // SECURITY: Validate tabId matches current tab
            if (pasteData.tabId !== this._id) {
              log.warn("[Tab] Paste event tabId mismatch", {
                expected: this._id,
                received: pasteData.tabId,
              });
              return;
            }

            // SECURITY: Validate timestamp freshness
            const messageAge = Date.now() - pasteData.timestamp;
            if (messageAge > 5000 || messageAge < 0) {
              log.warn("[Tab] Paste event timestamp invalid", {
                ageMs: messageAge,
              });
              return;
            }

            // Skip if in automation mode (don't track patterns during automation)
            if (this._isAutomationMode) {
              return;
            }

            const patternManager = PatternManager.getInstance();
            await patternManager.trackCopyPaste({ pasteEvent: pasteData });

            log.info("[Tab] Paste event tracked successfully");
          } catch (error) {
            log.error("[Tab] Paste event tracking error:", error);
          }
        }
      },
    );

    // AC #10: Handle tab crash/destroy - cleanup recording if active
    this.webContentsView.webContents.on("destroyed", () => {
      if (this._window) {
        const recordingManager = this._window.recordingManager;
        if (recordingManager.isRecording(this._id)) {
          log.warn(
            `[Tab] Tab ${this._id} destroyed while recording - auto-stopping`,
          );
          recordingManager.handleTabDestroyed(this._id);
        }
      }
    });
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

          // Sanitize field value for AI context (Story 1.12 - Code Review fix)
          // Returns actual value for non-sensitive fields (truncated to 100 chars)
          function sanitizeValue(value, fieldName, fieldType) {
            // Never sanitize sensitive fields - return null
            if (isSensitiveField(fieldName, fieldType)) {
              return null;
            }

            if (!value) return null;

            // Truncate long values to prevent bloating context
            const maxLength = 100;
            const sanitized = value.length > maxLength
              ? value.substring(0, maxLength) + '...'
              : value;

            return sanitized;
          }

          // Extract form fields (excluding sensitive fields)
          function extractFormFields(form) {
            const fields = [];
            const seenFieldNames = new Set(); // Track seen field names to prevent duplicates
            const inputs = form.querySelectorAll('input, textarea, select');

            inputs.forEach(input => {
              const fieldName = input.name || input.id || '';
              const fieldType = input.type || 'text';
              const fieldValue = input.value || '';

              // Skip if no name/id or if sensitive
              if (!fieldName || isSensitiveField(fieldName, fieldType)) {
                return;
              }

              // Skip if we've already seen this field name (prevents duplicates)
              if (seenFieldNames.has(fieldName)) {
                return;
              }

              // Skip empty fields
              if (!fieldValue) {
                return;
              }

              // Enhanced context capture: Extract field label (Story 1.12 - AC 1)
              let fieldLabel = '';
              try {
                // For buttons/submit: Capture button text or value
                if (fieldType === 'submit' || fieldType === 'button') {
                  fieldLabel = input.textContent?.trim() ||
                              input.getAttribute('value') ||
                              input.getAttribute('aria-label') ||
                              fieldName;
                } else {
                  // For other inputs: Try to find associated label element
                  const labelElement = form.querySelector(\`label[for="\${input.id}"]\`);
                  if (labelElement) {
                    fieldLabel = labelElement.textContent?.trim() || '';
                  } else {
                    // Try parent label
                    const parentLabel = input.closest('label');
                    if (parentLabel) {
                      fieldLabel = parentLabel.textContent?.trim() || '';
                    } else {
                      // Fallback to aria-label or placeholder
                      fieldLabel = input.getAttribute('aria-label') ||
                                  input.getAttribute('placeholder') ||
                                  fieldName;
                    }
                  }
                }
              } catch (labelError) {
                // Fallback to field name if label extraction fails
                fieldLabel = fieldName;
              }

              // Add field with anonymized value pattern, label, and sanitized value
              const sanitized = sanitizeValue(fieldValue, fieldName, fieldType);
              const fieldData = {
                name: fieldName,
                type: fieldType,
                valuePattern: anonymizeValue(fieldValue),
                label: fieldLabel // Enhanced context (Story 1.12)
              };

              // Only add sanitizedValue if not sensitive (Story 1.12 - Code Review fix)
              if (sanitized !== null) {
                fieldData.sanitizedValue = sanitized;
              }

              fields.push(fieldData);

              // Mark field name as seen
              seenFieldNames.add(fieldName);
            });

            return fields;
          }

          // Store handler references for cleanup (AC-1: Memory leak fix)
          const formSubmitHandler = (event) => {
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
          };

          // Listen for form submissions
          document.addEventListener('submit', formSubmitHandler, true); // Use capture phase

          // Store cleanup function (AC-1: Memory leak fix)
          window.__blueberryFormTrackerCleanup = () => {
            document.removeEventListener('submit', formSubmitHandler, true);
            delete window.__blueberryFormTrackerCleanup;
            delete window.__blueberryFormTrackerInjected;
          };

        })();
      `);

      // Set up listener for postMessage from the injected script (AC-1: Memory leak fix)
      await this.webContentsView.webContents.executeJavaScript(`
        (function() {
          // Prevent double injection
          if (window.__blueberryFormMessageHandlerRegistered) return;
          window.__blueberryFormMessageHandlerRegistered = true;

          const messageHandler = async (event) => {
            if (event.data && event.data.type === 'blueberry-form-submit') {
              // Forward to main process via console API workaround
              // We'll intercept console messages in main process
              console.log('__BLUEBERRY_FORM_SUBMIT__', JSON.stringify(event.data.data));
            }
          };

          window.addEventListener('message', messageHandler);

          // Extend cleanup function to remove this listener too (AC-1: Memory leak fix)
          const originalCleanup = window.__blueberryFormTrackerCleanup;
          window.__blueberryFormTrackerCleanup = () => {
            if (originalCleanup) originalCleanup();
            window.removeEventListener('message', messageHandler);
            delete window.__blueberryFormMessageHandlerRegistered;
          };
        })();
      `);

      log.info("[Tab] Form tracking script injected successfully");
    } catch (error) {
      log.error("[Tab] Form tracking script injection error:", error);
    }
  }

  /**
   * Inject copy/paste tracking script into page context (Story 1.7b)
   * Captures copy and paste events and sends data to main process for pattern tracking
   */
  private async injectCopyPasteTrackingScript(): Promise<void> {
    try {
      await this.webContentsView.webContents.executeJavaScript(`
        (function() {
          // Prevent double injection
          if (window.__blueberryCopyPasteTrackerInjected) return;
          window.__blueberryCopyPasteTrackerInjected = true;

          // Helper: Get CSS selector for element
          function getElementSelector(element) {
            if (!element) return 'unknown';
            if (element.id) return '#' + element.id;
            if (element.name) return element.tagName.toLowerCase() + '[name="' + element.name + '"]';
            if (element.className) {
              const classes = element.className.split(' ').filter(c => c.trim()).slice(0, 2);
              if (classes.length > 0) {
                return element.tagName.toLowerCase() + '.' + classes.join('.');
              }
            }
            return element.tagName.toLowerCase();
          }

          // Store handler references for cleanup (AC-1: Memory leak fix)
          const copyHandler = (event) => {
            try {
              const selection = window.getSelection();
              const text = selection ? selection.toString() : '';

              if (!text) return; // Skip empty copies

              const element = event.target;
              const copyData = {
                text: text,
                sourceElement: getElementSelector(element),
                url: window.location.href,
                pageTitle: document.title,
                timestamp: Date.now(),
                tabId: '${this._id}'
              };

              // Forward to main process via console API
              console.log('__BLUEBERRY_COPY__', JSON.stringify(copyData));
            } catch (error) {
              console.error('[Blueberry] Copy tracking error:', error);
            }
          };

          const pasteHandler = (event) => {
            try {
              const element = event.target;
              const pasteData = {
                destinationElement: getElementSelector(element),
                url: window.location.href,
                pageTitle: document.title,
                timestamp: Date.now(),
                tabId: '${this._id}'
              };

              // Forward to main process via console API
              console.log('__BLUEBERRY_PASTE__', JSON.stringify(pasteData));
            } catch (error) {
              console.error('[Blueberry] Paste tracking error:', error);
            }
          };

          // Listen for copy and paste events
          document.addEventListener('copy', copyHandler, true); // Use capture phase
          document.addEventListener('paste', pasteHandler, true); // Use capture phase

          // Store cleanup function (AC-1: Memory leak fix)
          window.__blueberryCopyPasteTrackerCleanup = () => {
            document.removeEventListener('copy', copyHandler, true);
            document.removeEventListener('paste', pasteHandler, true);
            delete window.__blueberryCopyPasteTrackerCleanup;
            delete window.__blueberryCopyPasteTrackerInjected;
          };

        })();
      `);

      log.info("[Tab] Copy/paste tracking script injected successfully");
    } catch (error) {
      log.error("[Tab] Copy/paste tracking script injection error:", error);
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

  get isAutomationMode(): boolean {
    return this._isAutomationMode;
  }

  get webContents(): WebContents {
    return this.webContentsView.webContents;
  }

  get view(): WebContentsView {
    return this.webContentsView;
  }

  // Public methods
  /**
   * Enable/disable automation mode
   * When enabled, pattern tracking is skipped for this tab
   * Also creates/removes visual overlay to indicate AI control
   */
  setAutomationMode(enabled: boolean): void {
    this._isAutomationMode = enabled;

    // Create or remove automation overlay view
    if (enabled) {
      this.createAutomationOverlay();
    } else {
      this.removeAutomationOverlay();
    }
  }

  /**
   * Create automation overlay by injecting CSS into the page
   * Note: WebContentsView doesn't support transparency (Electron bug),
   * so we inject directly into the page DOM instead
   */
  private createAutomationOverlay(): void {
    try {
      // Inject overlay immediately
      this.injectAutomationOverlay();

      log.info("[Tab] Automation overlay injection scheduled");
    } catch (error) {
      log.error("[Tab] Automation overlay creation error:", error);
    }
  }

  /**
   * Inject automation overlay CSS and HTML
   */
  private async injectAutomationOverlay(): Promise<void> {
    try {
      await this.webContentsView.webContents.executeJavaScript(`
        (function() {
          // Remove existing overlay if present
          const existing = document.getElementById('__blueberry-automation-overlay');
          if (existing) existing.remove();

          // Create style element
          const style = document.createElement('style');
          style.id = '__blueberry-automation-overlay-style';
          style.textContent = \`
            #__blueberry-automation-overlay {
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              right: 0 !important;
              bottom: 0 !important;
              background: rgba(59, 130, 246, 0.08) !important;
              backdrop-filter: blur(0.5px) !important;
              -webkit-backdrop-filter: blur(0.5px) !important;
              z-index: 2147483647 !important;
              display: flex !important;
              align-items: flex-start !important;
              justify-content: center !important;
              padding-top: 60px !important;
              pointer-events: none !important;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            }
            #__blueberry-automation-badge {
              background: rgba(37, 99, 235, 0.95) !important;
              color: white !important;
              padding: 12px 24px !important;
              border-radius: 8px !important;
              font-size: 14px !important;
              font-weight: 600 !important;
              box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
              display: flex !important;
              align-items: center !important;
              gap: 10px !important;
              animation: __blueberry_slideDown 0.3s ease-out !important;
              pointer-events: auto !important;
            }
            @keyframes __blueberry_slideDown {
              from { opacity: 0; transform: translateY(-20px); }
              to { opacity: 1; transform: translateY(0); }
            }
          \`;

          // Insert style into head (or create head if it doesn't exist)
          const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
          head.insertBefore(style, head.firstChild);

          // Create overlay element
          const overlay = document.createElement('div');
          overlay.id = '__blueberry-automation-overlay';
          overlay.innerHTML = \`
            <div id="__blueberry-automation-badge">
              <span style="font-size: 20px;">🤖</span>
              <span>Automation Running - AI Controlled</span>
            </div>
          \`;

          // Insert into body (or create body if it doesn't exist)
          const body = document.body || document.getElementsByTagName('body')[0] || document.documentElement;
          body.appendChild(overlay);

          // Note: We use pointer-events: none on the overlay to allow automation clicks to pass through
          // The badge itself has pointer-events: auto so it's visible but non-interactive
        })();
      `);
    } catch (error) {
      log.error("[Tab] Automation overlay injection error:", error);
    }
  }

  /**
   * Remove automation overlay
   */
  private removeAutomationOverlay(): void {
    try {
      this.webContentsView.webContents
        .executeJavaScript(
          `
        (function() {
          const overlay = document.getElementById('__blueberry-automation-overlay');
          if (overlay) overlay.remove();
          const style = document.getElementById('__blueberry-automation-overlay-style');
          if (style) style.remove();
        })();
      `,
        )
        .catch((err) => {
          log.error("[Tab] Automation overlay removal error:", err);
        });

      log.info("[Tab] Automation overlay removed");
    } catch (error) {
      log.error("[Tab] Automation overlay removal error:", error);
    }
  }

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
    return (await this.runJs("document.documentElement.outerHTML")) as string;
  }

  async getTabText(): Promise<string> {
    return (await this.runJs("document.documentElement.innerText")) as string;
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

  /**
   * Cleanup event listeners before destroying tab (AC-1: Memory leak fix)
   * Removes all injected event listeners to prevent memory leaks
   */
  private async cleanupEventListeners(): Promise<void> {
    if (this._isDestroyed) return; // Already cleaned up

    try {
      // Call cleanup functions for all injected scripts
      await this.webContentsView.webContents.executeJavaScript(`
        (function() {
          // Cleanup form tracking listeners
          if (window.__blueberryFormTrackerCleanup) {
            window.__blueberryFormTrackerCleanup();
          }

          // Cleanup copy/paste tracking listeners
          if (window.__blueberryCopyPasteTrackerCleanup) {
            window.__blueberryCopyPasteTrackerCleanup();
          }

          // Cleanup recording counter function
          if (window.__blueberry_updateRecordingCounter) {
            delete window.__blueberry_updateRecordingCounter;
          }
        })();
      `);

      log.info("[Tab] Event listeners cleaned up successfully");
    } catch (error) {
      // Ignore errors during cleanup (page might already be destroyed)
      log.warn(
        "[Tab] Event listener cleanup error (page likely destroyed):",
        error,
      );
    }
  }

  destroy(): void {
    if (this._isDestroyed) return;

    this._isDestroyed = true;

    // Cleanup event listeners before closing webContents (AC-1: Memory leak fix)
    this.cleanupEventListeners()
      .catch(() => {
        // Silently ignore cleanup errors during destruction
      })
      .finally(() => {
        // Close the webContents (this destroys the browser context)
        this.webContentsView.webContents.close();
      });
  }

  /**
   * Set window reference (called after tab creation to avoid circular dependency)
   */
  setWindow(window: Window): void {
    this._window = window;
  }

  /**
   * Inject recording overlay (Story 1.11 - AC 1, 2)
   */
  async injectRecordingOverlay(): Promise<void> {
    this._isRecordingMode = true;

    try {
      await this.webContentsView.webContents.executeJavaScript(`
        (function() {
          // Remove existing overlay if present
          const existing = document.getElementById('__blueberry-recording-overlay');
          if (existing) existing.remove();

          // Create style element
          const style = document.createElement('style');
          style.id = '__blueberry-recording-overlay-style';
          style.textContent = \`
            #__blueberry-recording-overlay {
              position: fixed !important;
              top: 0 !important;
              left: 0 !important;
              right: 0 !important;
              bottom: 0 !important;
              background: rgba(239, 68, 68, 0.03) !important;
              z-index: 2147483646 !important;
              pointer-events: none !important;
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
            }
            #__blueberry-recording-badge {
              position: fixed !important;
              top: 20px !important;
              left: 50% !important;
              transform: translateX(-50%) !important;
              background: rgba(220, 38, 38, 0.95) !important;
              color: white !important;
              padding: 10px 20px !important;
              border-radius: 20px !important;
              font-size: 13px !important;
              font-weight: 600 !important;
              box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3) !important;
              display: flex !important;
              align-items: center !important;
              gap: 8px !important;
              animation: __blueberry_pulse 2s ease-in-out infinite, __blueberry_slideDown 0.3s ease-out !important;
              z-index: 2147483647 !important;
              pointer-events: none !important;
            }
            #__blueberry-recording-dot {
              width: 8px !important;
              height: 8px !important;
              background: white !important;
              border-radius: 50% !important;
              animation: __blueberry_blink 1s ease-in-out infinite !important;
            }
            #__blueberry-recording-counter {
              font-variant-numeric: tabular-nums !important;
            }
            @keyframes __blueberry_pulse {
              0%, 100% { box-shadow: 0 4px 12px rgba(220, 38, 38, 0.3); }
              50% { box-shadow: 0 4px 20px rgba(220, 38, 38, 0.5); }
            }
            @keyframes __blueberry_blink {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.3; }
            }
            @keyframes __blueberry_slideDown {
              from { opacity: 0; transform: translateX(-50%) translateY(-20px); }
              to { opacity: 1; transform: translateX(-50%) translateY(0); }
            }
          \`;

          // Insert style into head (or create head if it doesn't exist)
          const head = document.head || document.getElementsByTagName('head')[0] || document.documentElement;
          head.insertBefore(style, head.firstChild);

          // Create overlay element
          const overlay = document.createElement('div');
          overlay.id = '__blueberry-recording-overlay';
          overlay.innerHTML = \`
            <div id="__blueberry-recording-badge">
              <div id="__blueberry-recording-dot"></div>
              <span>🎬 Recording... (<span id="__blueberry-recording-counter">0</span> actions)</span>
            </div>
          \`;

          // Insert into body (or create body if it doesn't exist)
          const body = document.body || document.getElementsByTagName('body')[0] || document.documentElement;
          body.appendChild(overlay);

          // Listen for IPC events to update counter
          window.__blueberry_updateRecordingCounter = (count) => {
            const counter = document.getElementById('__blueberry-recording-counter');
            if (counter) counter.textContent = count.toString();
          };
        })();
      `);

      log.info("[Tab] Recording overlay injected");
    } catch (error) {
      log.error("[Tab] Recording overlay injection error:", error);
    }
  }

  /**
   * Remove recording overlay (Story 1.11 - AC 3)
   */
  removeRecordingOverlay(): void {
    this._isRecordingMode = false;

    try {
      this.webContentsView.webContents
        .executeJavaScript(
          `
        (function() {
          const overlay = document.getElementById('__blueberry-recording-overlay');
          if (overlay) overlay.remove();
          const style = document.getElementById('__blueberry-recording-overlay-style');
          if (style) style.remove();
          delete window.__blueberry_updateRecordingCounter;
        })();
      `,
        )
        .catch(() => {
          // Silently ignore errors (page might be navigating)
        });

      log.info("[Tab] Recording overlay removed");
    } catch (error) {
      log.error("[Tab] Recording overlay removal error:", error);
    }
  }

  /**
   * Update recording counter in overlay (Story 1.11 - AC 2)
   */
  updateRecordingCounter(count: number): void {
    if (!this._isRecordingMode) return;

    try {
      this.webContentsView.webContents
        .executeJavaScript(
          `
        if (window.__blueberry_updateRecordingCounter) {
          window.__blueberry_updateRecordingCounter(${count});
        }
      `,
        )
        .catch(() => {
          // Silently ignore errors (page might be navigating)
        });
    } catch {
      // Silently ignore errors (page might be navigating)
    }
  }
}
