import React, { useState, useEffect, useRef, useCallback } from "react";
import { X, RotateCcw, Save, Loader2 } from "lucide-react";
import { Button } from "@common/components/Button";
import { Modal } from "@common/components/Modal";
import { WorkflowDisplay } from "./WorkflowDisplay";

interface Message {
  role: "assistant" | "user";
  content: string;
}

interface WorkflowRefinementDialogProps {
  isOpen: boolean;
  automationId: string;
  automationName: string;
  intentSummary?: string;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * WorkflowRefinementDialog - Conversational workflow customization dialog
 *
 * Allows users to refine and customize saved automations through natural conversation with AI.
 * AI asks clarifying questions based on workflow type, accumulates preferences, and saves refinements.
 */
export const WorkflowRefinementDialog: React.FC<
  WorkflowRefinementDialogProps
> = ({
  isOpen,
  automationId,
  automationName,
  intentSummary,
  onClose,
  onSaved,
}) => {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [userInput, setUserInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposedChanges, setProposedChanges] = useState<{
    customizations: Record<string, unknown>;
    originalWorkflow: Record<string, unknown>;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * Start refinement conversation
   */
  const startConversation = useCallback(async (): Promise<void> => {
    try {
      setLoading(true);
      setError(null);

      const result =
        await window.sidebarAPI.workflow.startRefinement(automationId);

      if (result.success && result.data) {
        setConversationId(result.data.conversationId);
        setMessages([
          { role: "assistant", content: result.data.greeting },
          { role: "assistant", content: result.data.firstQuestion },
        ]);
      } else {
        setError(
          result.error?.message || "Failed to start refinement conversation",
        );
      }
    } catch (err) {
      console.error("[WorkflowRefinementDialog] Start error:", err);
      setError("AI refinement unavailable - please try again later");
    } finally {
      setLoading(false);
    }
  }, [automationId]);

  /**
   * Initialize conversation when dialog opens
   */
  useEffect(() => {
    if (isOpen && !conversationId) {
      startConversation();
    }
  }, [isOpen, conversationId, startConversation]);

  /**
   * Auto-scroll to bottom when new messages arrive
   */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  /**
   * Focus input when dialog opens
   */
  useEffect(() => {
    if (isOpen && !loading) {
      inputRef.current?.focus();
    }
  }, [isOpen, loading]);

  /**
   * Send user message to AI
   */
  const sendMessage = async (): Promise<void> => {
    if (!userInput.trim() || !conversationId || loading) {
      return;
    }

    const messageText = userInput.trim();
    setUserInput("");
    setMessages((prev) => [...prev, { role: "user", content: messageText }]);

    try {
      setLoading(true);
      setError(null);

      const result = await window.sidebarAPI.workflow.sendMessage(
        conversationId,
        messageText,
      );

      if (result.success && result.data) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.data!.aiResponse },
        ]);
        setIsComplete(result.data!.isComplete);

        // If conversation complete, store changes for preview
        if (
          result.data!.isComplete &&
          result.data!.customizations &&
          result.data!.originalWorkflow
        ) {
          setProposedChanges({
            customizations: result.data!.customizations,
            originalWorkflow: result.data!.originalWorkflow,
          });
        }
      } else {
        setError(result.error?.message || "Failed to send message");
      }
    } catch (err) {
      console.error("[WorkflowRefinementDialog] Send message error:", err);
      setError("AI refinement unavailable - please try again later");
    } finally {
      setLoading(false);
    }
  };

  /**
   * Handle Enter key to send message
   */
  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  /**
   * Save refined workflow
   */
  const handleSave = async (): Promise<void> => {
    if (!conversationId || saving) {
      return;
    }

    try {
      setSaving(true);
      setError(null);

      const result =
        await window.sidebarAPI.workflow.saveRefined(conversationId);

      if (result.success) {
        // Success! Close dialog and notify parent
        onSaved();
        handleClose();
      } else {
        setError(
          result.error?.message || "Failed to save refinement - please retry",
        );
      }
    } catch (err) {
      console.error("[WorkflowRefinementDialog] Save error:", err);
      setError("Failed to save refinement - please retry");
    } finally {
      setSaving(false);
    }
  };

  /**
   * Reset conversation (Start Over)
   */
  const handleReset = async (): Promise<void> => {
    if (!conversationId || resetting) {
      return;
    }

    try {
      setResetting(true);
      setError(null);

      const result = await window.sidebarAPI.workflow.reset(conversationId);

      if (result.success) {
        // Clear local state and restart
        setMessages([]);
        setIsComplete(false);
        setConversationId(null);
        await startConversation();
      } else {
        setError(result.error?.message || "Failed to reset conversation");
      }
    } catch (err) {
      console.error("[WorkflowRefinementDialog] Reset error:", err);
      setError("Failed to reset conversation");
    } finally {
      setResetting(false);
    }
  };

  /**
   * Close dialog and reset state
   */
  const handleClose = (): void => {
    setConversationId(null);
    setMessages([]);
    setUserInput("");
    setIsComplete(false);
    setError(null);
    setProposedChanges(null);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Refine Workflow: ${automationName}`}
    >
      <div className="flex flex-col h-[600px]">
        {/* Intent Summary */}
        {intentSummary && (
          <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 rounded-md border border-blue-200 dark:border-blue-800">
            <p className="text-sm text-blue-700 dark:text-blue-300">
              {intentSummary}
            </p>
          </div>
        )}

        {/* Changes Preview (shown when conversation complete) */}
        {proposedChanges && proposedChanges.customizations && (
          <div className="mb-4">
            {/* Show modified workflow if it has steps */}
            <WorkflowDisplay
              workflow={
                proposedChanges.customizations as Record<string, unknown>
              }
              title="Modified Workflow"
              collapsible={true}
            />
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 rounded-md border border-red-200 dark:border-red-800">
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto mb-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-md border border-gray-200 dark:border-gray-700">
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div
                key={index}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] px-4 py-2 rounded-lg ${
                    message.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700"
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] px-4 py-2 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin text-gray-600 dark:text-gray-400" />
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                      AI is thinking...
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Area */}
        <div className="mb-4">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder={
                loading
                  ? "Waiting for AI..."
                  : isComplete
                    ? "Refinement complete - click Save or Start Over"
                    : "Type your response..."
              }
              disabled={loading || isComplete}
              className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <Button
              onClick={sendMessage}
              disabled={!userInput.trim() || loading || isComplete}
              size="sm"
            >
              Send
            </Button>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2 justify-between pt-2 border-t border-gray-200 dark:border-gray-700">
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleReset}
              disabled={loading || saving || resetting || !conversationId}
              size="sm"
            >
              {resetting ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Resetting...
                </>
              ) : (
                <>
                  <RotateCcw className="h-3 w-3 mr-1" />
                  Start Over
                </>
              )}
            </Button>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={handleClose}
              disabled={loading || saving}
              size="sm"
            >
              <X className="h-3 w-3 mr-1" />
              Cancel
            </Button>

            <Button
              onClick={handleSave}
              disabled={!isComplete || saving}
              size="sm"
            >
              {saving ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-3 w-3 mr-1" />
                  Save Changes
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
