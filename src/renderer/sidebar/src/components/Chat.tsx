import React, { useState, useRef, useEffect, useLayoutEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { ArrowUp, Plus, Zap } from "lucide-react";
import { useChat } from "../contexts/ChatContext";
import { cn } from "@common/lib/utils";
import { Button } from "@common/components/Button";
import { PatternActionMessage } from "./PatternActionMessage";
import { AIPatternMessage } from "./AIPatternMessage";
// TODO: Story 1.14/1.16 - Components not implemented yet
// import { ProactiveSuggestion } from "./ProactiveSuggestion";
// import { ProgressMessage } from "./ProgressMessage";

interface PatternData {
  notificationId: string;
  patternData: {
    id: string;
    patternType: "navigation" | "form" | "copy-paste";
    confidence: number;
    occurrenceCount: number;
    intentSummary?: string; // Story 1.13 - SHORT summary (20-30 words)
    intentSummaryDetailed?: string; // Story 1.13 - DETAILED summary (40-50 words)
    patternData?: {
      sequence?: Array<{ url: string }>;
      domain?: string;
      fields?: Array<unknown>;
    };
  };
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: number;
  isStreaming?: boolean;
  patternData?: PatternData;
}

// Auto-scroll hook
const useAutoScroll = (
  messages: Message[],
): React.RefObject<HTMLDivElement | null> => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const prevCount = useRef(0);

  useLayoutEffect(() => {
    if (messages.length > prevCount.current) {
      setTimeout(() => {
        scrollRef.current?.scrollIntoView({
          behavior: "smooth",
          block: "end",
        });
      }, 100);
    }
    prevCount.current = messages.length;
  }, [messages.length]);

  return scrollRef;
};

// User Message Component - appears on the right
const UserMessage: React.FC<{ content: string }> = ({ content }) => (
  <div className="relative max-w-[85%] ml-auto animate-fade-in">
    <div className="bg-muted dark:bg-muted/50 rounded-3xl px-6 py-4">
      <div className="text-foreground" style={{ whiteSpace: "pre-wrap" }}>
        {content}
      </div>
    </div>
  </div>
);

// Streaming Text Component
const StreamingText: React.FC<{ content: string }> = ({ content }) => {
  const [displayedContent, setDisplayedContent] = useState("");
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < content.length) {
      const timer = setTimeout(() => {
        setDisplayedContent(content.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }, 10);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [content, currentIndex]);

  return (
    <div className="whitespace-pre-wrap text-foreground">
      {displayedContent}
      {currentIndex < content.length && (
        <span className="inline-block w-2 h-5 bg-primary/60 dark:bg-primary/40 ml-0.5 animate-pulse" />
      )}
    </div>
  );
};

// Markdown Renderer Component
const Markdown: React.FC<{ content: string }> = ({ content }) => (
  <div
    className="prose prose-sm dark:prose-invert max-w-none 
                    prose-headings:text-foreground prose-p:text-foreground 
                    prose-strong:text-foreground prose-ul:text-foreground 
                    prose-ol:text-foreground prose-li:text-foreground
                    prose-a:text-primary hover:prose-a:underline
                    prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 
                    prose-code:rounded prose-code:text-sm prose-code:text-foreground
                    prose-pre:bg-muted dark:prose-pre:bg-muted/50 prose-pre:p-3 
                    prose-pre:rounded-lg prose-pre:overflow-x-auto"
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      components={{
        // Custom code block styling
        code: ({ className, children, ...props }) => {
          const inline = !className;
          return inline ? (
            <code
              className="bg-muted dark:bg-muted/50 px-1 py-0.5 rounded text-sm text-foreground"
              {...props}
            >
              {children}
            </code>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        // Custom link styling
        a: ({ children, href }) => (
          <a
            href={href}
            className="text-primary hover:underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

// Assistant Message Component - appears on the left
const AssistantMessage: React.FC<{
  content: string;
  isStreaming?: boolean;
}> = ({ content, isStreaming }) => (
  <div className="relative w-full animate-fade-in">
    <div className="py-1">
      {isStreaming ? (
        <StreamingText content={content} />
      ) : (
        <Markdown content={content} />
      )}
    </div>
  </div>
);

// Loading Indicator with spinning star
const LoadingIndicator: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    setIsVisible(true);
  }, []);

  return (
    <div
      className={cn(
        "transition-transform duration-300 ease-in-out",
        isVisible ? "scale-100" : "scale-0",
      )}
    >
      ...
    </div>
  );
};

// Chat Input Component with pill design
const ChatInput: React.FC<{
  onSend: (message: string) => void;
  disabled: boolean;
}> = ({ onSend, disabled }) => {
  const [value, setValue] = useState("");
  const [isFocused, setIsFocused] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      const scrollHeight = textareaRef.current.scrollHeight;
      const newHeight = Math.min(scrollHeight, 200); // Max 200px
      textareaRef.current.style.height = `${newHeight}px`;
    }
  }, [value]);

  const handleSubmit = (): void => {
    if (value.trim() && !disabled) {
      onSend(value.trim());
      setValue("");
      // Reset textarea height
      if (textareaRef.current) {
        textareaRef.current.style.height = "24px";
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div
      className={cn(
        "w-full border p-3 rounded-3xl bg-background dark:bg-secondary",
        "shadow-chat animate-spring-scale outline-none transition-all duration-200",
        isFocused
          ? "border-primary/20 dark:border-primary/30"
          : "border-border",
      )}
    >
      {/* Input Area */}
      <div className="w-full px-3 py-2">
        <div className="w-full flex items-start gap-3">
          <div className="relative flex-1 overflow-hidden">
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setIsFocused(true)}
              onBlur={() => setIsFocused(false)}
              onKeyDown={handleKeyDown}
              placeholder="Send a message..."
              className="w-full resize-none outline-none bg-transparent 
                                     text-foreground placeholder:text-muted-foreground
                                     min-h-[24px] max-h-[200px]"
              rows={1}
              style={{ lineHeight: "24px" }}
            />
          </div>
        </div>
      </div>

      {/* Send Button */}
      <div className="w-full flex items-center gap-1.5 px-1 mt-2 mb-1">
        <div className="flex-1" />
        <button
          onClick={handleSubmit}
          disabled={disabled || !value.trim()}
          className={cn(
            "size-9 rounded-full flex items-center justify-center",
            "transition-all duration-200",
            "bg-primary text-primary-foreground",
            "hover:opacity-80 disabled:opacity-50",
          )}
        >
          <ArrowUp className="size-5" />
        </button>
      </div>
    </div>
  );
};

// Helper function to generate conversational pattern messages
// Story 1.13 - AC 2: Use SHORT summary for conversational message (more natural)
const generatePatternMessage = (
  pattern: PatternData["patternData"],
): string => {
  const {
    patternType,
    occurrenceCount,
    confidence,
    patternData,
    intentSummaryDetailed,
  } = pattern;

  // Story 1.13 - AC 2: Use DETAILED summary for conversational message (includes value prop)
  if (intentSummaryDetailed) {
    // DETAILED summary now includes the value prop, so just wrap it in friendly greeting
    return `Hey! I noticed you've been ${intentSummaryDetailed.toLowerCase()}. Want to save this as an automation?`;
  }

  // Fallback to template-based messages (Story 1.13 - AC 6)
  if (patternType === "navigation" && patternData?.sequence) {
    const urls = patternData.sequence
      .slice(0, 5) // Show first 5 URLs
      .map((s) => {
        try {
          const url = new URL(s.url);
          return url.hostname.replace(/^www\./, "");
        } catch {
          return s.url;
        }
      })
      .join(" → ");

    return `I noticed you've been navigating ${urls} ${occurrenceCount} times recently. This looks like a workflow you repeat often. Would you like me to convert this into an automation to save time?`;
  }

  if (patternType === "form" && patternData?.domain) {
    const fieldCount = patternData.fields?.length || 0;
    return `I've observed you filling out the ${patternData.domain} form (${fieldCount} fields) ${occurrenceCount} times. I can help automate this repetitive task. Would you like to save this as an automation?`;
  }

  if (patternType === "copy-paste") {
    return `I detected a copy/paste pattern that you've repeated ${occurrenceCount} times with ${confidence.toFixed(0)}% confidence. Would you like to convert this into an automation?`;
  }

  // Fallback generic message
  return `I detected a ${patternType} pattern that you've repeated ${occurrenceCount} times with ${confidence.toFixed(0)}% confidence. Would you like to convert this into an automation?`;
};

// Conversation Turn Component
interface ConversationTurn {
  user?: Message;
  assistant?: Message;
}

const ConversationTurnComponent: React.FC<{
  turn: ConversationTurn;
  isLoading?: boolean;
  onPatternDismiss?: (patternId: string) => void;
  onPatternAutomationSaved?: (message: string) => void;
  onPatternError?: (error: string) => void;
}> = ({
  turn,
  isLoading,
  onPatternDismiss,
  onPatternAutomationSaved,
  onPatternError,
}) => (
  <div className="pt-12 flex flex-col gap-8">
    {turn.user && <UserMessage content={turn.user.content} />}
    {turn.assistant && (
      <>
        {turn.assistant.patternData ? (
          // Story 1.13 - AC 2: Use AIPatternMessage when intent summaries available
          turn.assistant.patternData.patternData.intentSummaryDetailed ? (
            <AIPatternMessage
              content={turn.assistant.content}
              patternId={turn.assistant.patternData.patternData.id}
              patternData={turn.assistant.patternData.patternData}
              notificationId={turn.assistant.patternData.notificationId}
              onDismiss={() => {
                if (onPatternDismiss && turn.assistant?.patternData) {
                  onPatternDismiss(turn.assistant.id);
                }
              }}
              onAutomationSaved={(message) => {
                if (onPatternAutomationSaved) {
                  onPatternAutomationSaved(message);
                }
              }}
              onError={(error) => {
                if (onPatternError) {
                  onPatternError(error);
                }
              }}
            />
          ) : (
            // Fallback to PatternActionMessage for backward compatibility
            <PatternActionMessage
              content={turn.assistant.content}
              patternId={turn.assistant.patternData.patternData.id}
              patternData={turn.assistant.patternData.patternData}
              notificationId={turn.assistant.patternData.notificationId}
              onDismiss={() => {
                if (onPatternDismiss && turn.assistant?.patternData) {
                  onPatternDismiss(turn.assistant.id);
                }
              }}
              onAutomationSaved={(message) => {
                if (onPatternAutomationSaved) {
                  onPatternAutomationSaved(message);
                }
              }}
              onError={(error) => {
                if (onPatternError) {
                  onPatternError(error);
                }
              }}
            />
          )
        ) : (
          <AssistantMessage
            content={turn.assistant.content}
            isStreaming={turn.assistant.isStreaming}
          />
        )}
      </>
    )}
    {isLoading && (
      <div className="flex justify-start">
        <LoadingIndicator />
      </div>
    )}
  </div>
);

// Main Chat Component
interface ChatProps {
  pendingPatternData?: PatternData | null;
  onPatternProcessed?: () => void;
  onPatternActionComplete?: (notificationId: string) => void;
  onShowAutomations?: () => void;
}

export const Chat: React.FC<ChatProps> = ({
  pendingPatternData,
  onPatternProcessed,
  onPatternActionComplete,
  onShowAutomations,
}) => {
  const {
    messages: chatMessages,
    isLoading,
    sendMessage,
    clearChat,
  } = useChat();
  const [patternMessages, setPatternMessages] = useState<Message[]>([]);
  // Track which pattern notifications we've already created messages for
  const processedPatternNotifications = useRef<Set<string>>(new Set());

  // Story 1.14: Proactive Automation Suggestion State
  const [proactiveSuggestion, setProactiveSuggestion] = useState<{
    patternId: string;
    intentSummary: string;
    estimatedItems: number;
    matchCount: number;
  } | null>(null);

  // Debug: Log state changes
  useEffect(() => {
    console.log(
      "[Chat] proactiveSuggestion state updated:",
      proactiveSuggestion,
    );
  }, [proactiveSuggestion]);

  // TODO: Story 1.14: Execution Progress State (temporarily unused)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_executionProgress, _setExecutionProgress] = useState<{
    executionId: string;
    current: number;
    total: number;
    action: string;
  } | null>(null);

  // Combine chat messages and pattern messages
  const messages = [...chatMessages, ...patternMessages].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  const scrollRef = useAutoScroll(messages);

  // Pattern action handlers
  const handlePatternDismiss = (messageId: string): void => {
    setPatternMessages((prev) => prev.filter((m) => m.id !== messageId));
  };

  const handlePatternAutomationSaved = (
    messageId: string,
    successMessage: string,
  ): void => {
    // Extract notification ID from message ID (format: pattern-${notificationId})
    const notificationId = messageId.replace(/^pattern-/, "");

    // Mark notification as processed (permanent action taken)
    if (onPatternActionComplete) {
      onPatternActionComplete(notificationId);
    }

    // Add success message to chat
    const newMessage: Message = {
      id: `success-${Date.now()}`,
      role: "assistant",
      content: successMessage,
      timestamp: Date.now(),
    };
    setPatternMessages((prev) => [...prev, newMessage]);
  };

  const handlePatternError = (errorMessage: string): void => {
    // Add error message to chat
    const newMessage: Message = {
      id: `error-${Date.now()}`,
      role: "assistant",
      content: `❌ ${errorMessage}`,
      timestamp: Date.now(),
    };
    setPatternMessages((prev) => [...prev, newMessage]);
  };

  // Handle pattern notification clicks
  useEffect(() => {
    if (pendingPatternData && onPatternProcessed) {
      const notificationId = pendingPatternData.notificationId;

      // Check if we've already processed this notification (prevent duplicates)
      if (processedPatternNotifications.current.has(notificationId)) {
        onPatternProcessed();
        return;
      }

      // Mark as processed immediately (before state update)
      processedPatternNotifications.current.add(notificationId);

      // Generate conversational AI message about the pattern
      const content = generatePatternMessage(pendingPatternData.patternData);

      // Create pattern action message
      const newMessage: Message = {
        id: `pattern-${notificationId}`, // Use notification ID for uniqueness
        role: "assistant",
        content,
        timestamp: Date.now(),
        patternData: pendingPatternData,
      };

      setPatternMessages((prev) => [...prev, newMessage]);
      onPatternProcessed();
    }
  }, [pendingPatternData, onPatternProcessed]);

  // Story 1.14: Listen for proactive automation suggestions
  useEffect(() => {
    const handleSuggestContinuation = (data: {
      patternId: string;
      intentSummary: string;
      estimatedItems: number;
      matchCount: number;
    }): void => {
      console.log("[Chat] Received suggest-continuation event:", data);
      setProactiveSuggestion(data);
    };

    console.log("[Chat] Setting up suggest-continuation listener");
    window.sidebarAPI.pattern.onSuggestContinuation(handleSuggestContinuation);

    return () => {
      console.log("[Chat] Removing suggest-continuation listener");
      window.sidebarAPI.pattern.removeSuggestContinuationListener();
    };
  }, []);

  // Story 1.14: Listen for execution progress updates
  useEffect(() => {
    const handleExecutionProgress = (data: {
      executionId: string;
      current: number;
      total: number;
      action: string;
    }): void => {
      _setExecutionProgress(data);
    };

    const handleExecutionComplete = (data: {
      executionId: string;
      itemsProcessed: number;
      stepsExecuted?: number;
      patternContext?: {
        type: "navigation" | "form";
        urlCount?: number;
        firstUrl?: string;
        lastUrl?: string;
        domain?: string;
        fieldCount?: number;
      };
    }): void => {
      // Clear progress state
      _setExecutionProgress(null);

      // Generate contextual completion message (Story 1.14 - AC 5 enhanced)
      let content = `✅ Done! Completed ${data.itemsProcessed} iteration${data.itemsProcessed > 1 ? "s" : ""} successfully`;

      if (data.patternContext) {
        if (data.patternContext.type === "navigation") {
          const urlCount = data.patternContext.urlCount || 0;
          try {
            const firstUrl = data.patternContext.firstUrl
              ? new URL(data.patternContext.firstUrl).hostname
              : "pages";
            const lastUrl = data.patternContext.lastUrl
              ? new URL(data.patternContext.lastUrl).hostname
              : undefined;

            if (urlCount === 1) {
              content += ` — visited ${firstUrl}`;
            } else if (urlCount === 2) {
              content += ` — navigated between ${firstUrl} and ${lastUrl || "another page"}`;
            } else {
              content += ` — automated ${urlCount}-step navigation workflow`;
            }
          } catch {
            content += ` — automated navigation workflow`;
          }
        } else if (data.patternContext.type === "form") {
          const domain = data.patternContext.domain || "form";
          const fieldCount = data.patternContext.fieldCount || 0;
          content += ` — filled ${fieldCount} field${fieldCount > 1 ? "s" : ""} on ${domain}`;
        }
      }

      if (data.stepsExecuted) {
        content += `. Total steps: ${data.stepsExecuted}.`;
      } else {
        content += ".";
      }

      const completionMessage: Message = {
        id: `execution-complete-${Date.now()}`,
        role: "assistant",
        content,
        timestamp: Date.now(),
      };
      setPatternMessages((prev) => [...prev, completionMessage]);
    };

    const handleExecutionCancelled = (data: {
      executionId: string;
      stoppedAt: number;
    }): void => {
      // Clear progress state
      _setExecutionProgress(null);

      // Add cancellation message to chat
      const cancellationMessage: Message = {
        id: `execution-cancelled-${Date.now()}`,
        role: "assistant",
        content: `⏹️ Execution cancelled. Stopped at step ${data.stoppedAt}.`,
        timestamp: Date.now(),
      };
      setPatternMessages((prev) => [...prev, cancellationMessage]);
    };

    const handleExecutionError = (data: {
      executionId: string;
      error: string;
    }): void => {
      // Clear progress state
      _setExecutionProgress(null);

      // Add error message to chat
      const errorMessage: Message = {
        id: `execution-error-${Date.now()}`,
        role: "assistant",
        content: `❌ Execution failed: ${data.error}`,
        timestamp: Date.now(),
      };
      setPatternMessages((prev) => [...prev, errorMessage]);
    };

    window.sidebarAPI.pattern.onExecutionProgress(handleExecutionProgress);
    window.sidebarAPI.pattern.onExecutionComplete(handleExecutionComplete);
    window.sidebarAPI.pattern.onExecutionCancelled(handleExecutionCancelled);
    window.sidebarAPI.pattern.onExecutionError(handleExecutionError);

    return () => {
      window.sidebarAPI.pattern.removeExecutionProgressListener();
      window.sidebarAPI.pattern.removeExecutionCompleteListener();
      window.sidebarAPI.pattern.removeExecutionCancelledListener();
      window.sidebarAPI.pattern.removeExecutionErrorListener();
    };
  }, []);

  // Group messages into conversation turns
  const conversationTurns: ConversationTurn[] = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      const turn: ConversationTurn = { user: messages[i] };
      if (messages[i + 1]?.role === "assistant") {
        turn.assistant = messages[i + 1];
        i++; // Skip next message since we've paired it
      }
      conversationTurns.push(turn);
    } else if (
      messages[i].role === "assistant" &&
      (i === 0 || messages[i - 1]?.role !== "user")
    ) {
      // Handle standalone assistant messages
      conversationTurns.push({ assistant: messages[i] });
    }
  }

  // Check if we need to show loading after the last turn
  const showLoadingAfterLastTurn =
    isLoading && messages[messages.length - 1]?.role === "user";

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto">
        <div className="h-8 max-w-3xl mx-auto px-4 flex items-center justify-between">
          {/* Left side buttons */}
          <div className="flex gap-2">
            {messages.length > 0 && (
              <Button
                onClick={clearChat}
                title="Start new chat"
                variant="ghost"
              >
                <Plus className="size-4" />
                New Chat
              </Button>
            )}
          </div>

          {/* Right side buttons */}
          <div className="flex gap-2">
            {onShowAutomations && (
              <Button
                onClick={onShowAutomations}
                title="View automation library"
                variant="ghost"
                size="sm"
              >
                <Zap className="size-4" />
                Automations
              </Button>
            )}
          </div>
        </div>

        <div className="pb-4 relative max-w-3xl mx-auto px-4">
          {messages.length === 0 ? (
            // Empty State
            <div className="flex items-center justify-center h-full min-h-[400px]">
              <div className="text-center animate-fade-in max-w-md mx-auto gap-2 flex flex-col">
                <h3 className="text-2xl font-bold">🫐</h3>
                <p className="text-muted-foreground text-sm">
                  Press ⌘E to toggle the sidebar
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Render conversation turns */}
              {conversationTurns.map((turn, index) => (
                <ConversationTurnComponent
                  key={`turn-${index}`}
                  turn={turn}
                  isLoading={
                    showLoadingAfterLastTurn &&
                    index === conversationTurns.length - 1
                  }
                  onPatternDismiss={handlePatternDismiss}
                  onPatternAutomationSaved={(msg) => {
                    if (turn.assistant?.id) {
                      handlePatternAutomationSaved(turn.assistant.id, msg);
                    }
                  }}
                  onPatternError={handlePatternError}
                />
              ))}
            </>
          )}

          {/* Story 1.14: Proactive Automation Suggestion (AC 2, 3, 6) */}
          {/* NOTE: Moved outside messages conditional to show even with empty chat */}
          {/* TODO: Story 1.14 - ProactiveSuggestion component not implemented yet */}
          {/* {proactiveSuggestion && (
            <>
              {(() => {
                console.log(
                  "[Chat] Rendering ProactiveSuggestion component",
                  proactiveSuggestion,
                );
                return null;
              })()}
              <div className="pt-12">
                <ProactiveSuggestion
                  patternId={proactiveSuggestion.patternId}
                  intentSummary={proactiveSuggestion.intentSummary}
                  estimatedItems={proactiveSuggestion.estimatedItems}
                  matchCount={proactiveSuggestion.matchCount}
                  onDismiss={() => setProactiveSuggestion(null)}
                  onStarted={() => {
                    // Add starting message to chat
                    const startMessage: Message = {
                      id: `execution-start-${Date.now()}`,
                      role: "assistant",
                      content: `🚀 Starting automation... I'll keep you posted on the progress.`,
                      timestamp: Date.now(),
                    };
                    setPatternMessages((prev) => [...prev, startMessage]);
                    setProactiveSuggestion(null);
                  }}
                  onError={handlePatternError}
                />
              </div>
            </>
          )} */}

          {/* TODO: Story 1.14/1.16 - ProgressMessage component not implemented yet */}
          {/* {executionProgress && (
            <div className="pt-12">
              <ProgressMessage
                executionId={executionProgress.executionId}
                current={executionProgress.current}
                total={executionProgress.total}
                currentAction={executionProgress.action}
                onCancel={() => {
                  // Add cancellation confirmation to chat
                  const cancelMessage: Message = {
                    id: `execution-cancelling-${Date.now()}`,
                    role: "assistant",
                    content: `Cancelling automation...`,
                    timestamp: Date.now(),
                  };
                  setPatternMessages((prev) => [...prev, cancelMessage]);
                }}
                onError={handlePatternError}
              />
            </div>
          )} */}

          {/* Scroll anchor */}
          <div ref={scrollRef} />
        </div>
      </div>

      {/* Input Area */}
      <div className="p-4">
        <ChatInput onSend={sendMessage} disabled={isLoading} />
      </div>
    </div>
  );
};
