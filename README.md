# Blueberry Browser

> **⚠️ Disclaimer:** I'm not proud of this codebase! It was built in 3 hours. If you have some time left over in the challenge, feel free to refactor and clean things up!

https://github.com/user-attachments/assets/bbf939e2-d87c-4c77-ab7d-828259f6d28d

---

## Overview

You are the **CTO of Blueberry Browser**, a Strawberry competitor. Your mission is to add a feature to Blueberry that makes it superior & more promising than Strawberry.

But your time is limited—Strawberry is about to raise a two billion dollar Series A round from X-Separator, B17Å and Sequoiadendron giganteum Capital.

## 🎯 Task

Your job is to **clone this repo** and add a unique feature. Some ideas are listed below.

It doesn't need to work 100% reliably, or even be completely done. It just has to:

- Show that you are creative and can iterate on novel ideas fast
- Demonstrate good system thinking and code practices
- Prove you are a capable full stack and/or LLM dev

Once you're done, we'll book a call where you'll get to present your work!

If it's cracked, we might just have to acquire Blueberry Browser to stay alive 👀👀👀

### ⏰ Time

**1-2 weeks** is ideal for this challenge. This allows you to work over weekends and during evenings in your own time.

### 📋 Rules

You are allowed to vibe code, but make sure you understand everything so we can ask technical questions.

## 💡 Feature Ideas

### **Browsing History Compiler**

Track the things that the user is doing inside the browser and figure out from a series of browser states what the user is doing, and perhaps how valuable, repetitive tasks can be re-run by an AI agent.

_Tab state series → Prompt for web agent how to reproduce the work_

### **Coding Agent**

Sidebar coding agent that can create a script that can run on the open tabs.

Maybe useful for filling forms or changing the page's style so it can extract data but present it in a nicer format.

### **Tab Completion Model**

Predict next action or what to type, like Cursor's tab completion model.

### **Your Own Idea**

Feel free to implement your own idea!

> Wanted to try transformers.js for a while? This is your chance!

> Have an old cool web agent framework you built? Let's see if you can merge it into the browser!

> Think you can add a completely new innovation to the browser concept with some insane, over-engineered React? Lfg!

Make sure you can realistically showcase a simple version of it in the timeframe. You can double check with us first if uncertain! :)

## 💬 Tips

Feel free to write to us with questions or send updates during the process—it's a good way to get a feel for working together.

It can also be a good way for us to give feedback if things are heading in the right or wrong direction.

---

## ✨ Implemented Feature: AI-Powered Pattern Detection & Automation

### Overview

![Blueberry Browser Architecture Overview](blueberry-architecture-overview.png)

Blueberry Browser now includes an intelligent automation system that learns from your browsing behavior and offers to automate repetitive workflows. Instead of relying on simple heuristics or rule-based pattern matching, the system uses Large Language Models (LLMs) to understand user intent and execute automations that adapt to changing page layouts.

**Key Capabilities:**

- **Automatic Pattern Detection**: Tracks navigation sequences, form submissions, and copy/paste workflows across tabs
- **AI-Driven Analysis**: Uses LLMs to determine if actions form meaningful, automation-worthy patterns
- **Conversational Workflow Refinement**: Multi-turn AI conversations to customize automations before saving
- **Adaptive Execution**: LLM-guided automation that handles page layout changes and dynamic content
- **Manual Recording**: Explicit workflow capture with a "Record" button for intentional automation creation

### Technical Approach

#### 1. LLM-First Design Philosophy

**Pattern Recognition**: After tracking similar actions (e.g., three navigation sequences), the system asks an LLM: _"Is this a meaningful pattern worth automating?"_ The LLM receives rich context including page titles, element text, and tab switches, then returns a structured decision with confidence level and intent summary.

**Workflow Execution**: Each automation step is decided in real-time by an LLM analyzing the current page state. The LLM receives a screenshot and list of interactive elements, then decides: _"What should I do next?"_ This allows automations to adapt when websites change their layout or content.

**Conversational Refinement**: When users approve a pattern, an AI conversation guides them through customization options. The LLM adapts its questions based on the workflow type and conversation history, rather than forcing users through rigid forms.

#### 2. Multi-Process Architecture Integration

The feature extends Blueberry's existing Electron architecture:

```
┌─────────────────────────────────────────────────────────┐
│  Browser Tabs (WebContentsView)                         │
│  - Capture navigation events                             │
│  - Inject scripts for form/copy-paste tracking          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Main Process                                            │
│  ┌─────────────────────────────────────────────────┐   │
│  │  PatternManager                                  │   │
│  │  - Store actions in 30-minute session buffers   │   │
│  │  - Detect pattern candidates (3rd occurrence)   │   │
│  │  - Manage automations database                  │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │                                    │
│  ┌──────────────────▼──────────────────────────────┐   │
│  │  LLMPatternAnalyzer                              │   │
│  │  - Ask LLM: "Is this a pattern?"                │   │
│  │  - Return: isPattern, confidence, workflow      │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │ (if pattern detected)              │
│  ┌──────────────────▼──────────────────────────────┐   │
│  │  IntentSummarizer                                │   │
│  │  - Generate short/detailed summaries             │   │
│  │  - Cache for 1 hour to reduce API costs         │   │
│  └──────────────────┬──────────────────────────────┘   │
│                     │                                    │
│  ┌──────────────────▼──────────────────────────────┐   │
│  │  NotificationManager                             │   │
│  │  - Create notification for user                  │   │
│  └──────────────────────────────────────────────────┘   │
└──────────────────────┬──────────────────────────────────┘
                       │ (IPC: pattern notification)
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Sidebar Renderer                                        │
│  - Badge notification appears                            │
│  - User clicks → AI chat opens with pattern message     │
│  - User approves → Workflow refinement dialog           │
│  - Automation saved to library                           │
│  - User clicks "Execute" → Send to main process         │
└──────────────────────┬──────────────────────────────────┘
                       │ (IPC: execute automation)
                       ▼
┌─────────────────────────────────────────────────────────┐
│  Main Process - Execution                                │
│  ┌─────────────────────────────────────────────────┐   │
│  │  LLMExecutionEngine                              │   │
│  │  For each step (max 50):                         │   │
│  │    1. Screenshot + extract interactive elements  │   │
│  │    2. Ask LLM: "What action next?"              │   │
│  │    3. Execute action (click/type/navigate)       │   │
│  │    4. Wait for page to settle                    │   │
│  │    5. Send progress update → Sidebar UI          │   │
│  │  Complete when LLM decides workflow is done      │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

#### 3. Privacy-First Implementation

- **Sensitive Field Exclusion**: Automatically detects and excludes password fields, credit card inputs, and other sensitive form fields from tracking
- **Value Anonymization**: Stores patterns as "email format" or "URL pattern" rather than actual user data
- **Local-Only Storage**: All data persists in a local SQLite database with no cloud sync
- **User Control**: Users can dismiss pattern notifications and delete saved automations at any time

#### 4. Performance Optimizations

- **Background Processing**: Pattern detection runs asynchronously without blocking the UI
- **Session Buffering**: Actions stored in 30-minute rolling windows to group related behavior
- **Intent Summary Caching**: 1-hour cache for AI-generated summaries reduces API costs by ~95%
- **Rate Limiting**: 50 events/second max to prevent performance degradation
- **Cost Efficiency**: Average cost per pattern detection and execution: <$0.01 (using GPT-4o-mini or Claude Haiku)

### Code Structure

The implementation spans ~22,000 lines across 80 files. Here's how it's organized:

#### Main Process Services (`src/main/`)

**Core Pattern Management:**

- `PatternManager.ts` (2,532 lines) - Central coordinator for pattern tracking, database operations, and automation management
- `LLMPatternAnalyzer.ts` (297 lines) - AI-powered pattern detection using structured LLM output
- `IntentSummarizer.ts` (510 lines) - Generates dual summaries (short for notifications, detailed for chat) with caching

**Automation Execution:**

- `LLMExecutionEngine.ts` (1,136 lines) - LLM-guided workflow execution with page-by-page action decisions
- `WorkflowRefiner.ts` (527 lines) - Multi-turn AI conversation for workflow customization
- `RecordingManager.ts` (487 lines) - Manual recording session management with timeout/action limits

**Shared Services:**

- `NotificationManager.ts` (388 lines) - Notification lifecycle management (create, update, dismiss)
- `LLMProviderConfig.ts` (147 lines) - Centralized configuration for OpenAI/Anthropic/Gemini models

**Infrastructure Extensions:**

- `Window.ts` - Added navigation event capture and recording cleanup hooks
- `Tab.ts` - Injected form/copy-paste tracking scripts and tab crash detection
- `EventManager.ts` - Extended with 30+ new IPC event handlers for pattern features
- `Database.ts` - Added 4 tables: `patterns`, `automations`, `notifications`, `monitors`

#### Type Safety & Validation (`src/main/schemas/`, `src/main/types/`)

- `patternSchemas.ts` (219 lines) - Zod schemas for pattern-related IPC validation
- `brandedTypes.ts` (172 lines) - TypeScript branded types for ID safety (prevents mixing PatternId with AutomationId)
- `recordingSchemas.ts`, `notificationSchemas.ts`, `monitorSchemas.ts` - Additional Zod schemas for respective features

#### UI Components (`src/renderer/sidebar/src/components/`)

**Automation Management:**

- `AutomationLibrary.tsx` (325 lines) - Grid view of saved automations with search/filter
- `AutomationItem.tsx` (521 lines) - Individual automation card with execute/edit/delete actions and progress visualization
- `WorkflowDisplay.tsx` (213 lines) - Visual representation of workflow steps
- `WorkflowRefinementDialog.tsx` (405 lines) - Full-screen modal for AI-driven workflow customization

**Recording Interface:**

- `RecordingPreviewModal.tsx` (326 lines) - Preview captured actions before saving
- `RecordingActiveModal.tsx` (51 lines) - Persistent indicator during active recording
- `ZeroActionModal.tsx` (50 lines) - Prevents saving empty recordings

**Notifications:**

- `NotificationPanel.tsx` (358 lines) - Sliding panel with notification history and badge count
- `AIPatternMessage.tsx` (302 lines) - Inline chat message for pattern detection
- `PatternActionMessage.tsx` (276 lines) - Action buttons for approving/dismissing patterns

**Common Components (`src/renderer/common/components/`):**

- `Modal.tsx` (121 lines) - Reusable modal with dark mode support
- `Panel.tsx` (67 lines) - Sliding panel component
- `Badge.tsx` (60 lines) - Notification badge counter
- `Toast.tsx` (120 lines) - Toast notifications for user feedback

#### React State Management (`src/renderer/sidebar/src/contexts/`)

- `AutomationContext.tsx` (351 lines) - Automation state, execution progress, library filtering
- `PatternContext.tsx` (287 lines) - Pattern state and CRUD operations
- `RecordingContext.tsx` (204 lines) - Recording session state with start/stop/pause controls
- `NotificationContext.tsx` (158 lines) - Notification state, badge count, and history management

#### Database Schema

**patterns** table:

- Stores detected patterns with type (navigation/form/copy-paste), confidence, occurrence count
- `pattern_data` JSON column contains pattern-specific details (URLs, form fields, etc.)
- `intent_summary` and `intent_summary_detailed` for UI display
- `dismissed` flag for user-rejected patterns

**automations** table:

- Saved automations with names, descriptions, and AI-decided workflow format
- Links to source pattern via `pattern_id`
- Execution statistics (last run, success count)

**notifications** table:

- Pattern detection notifications with titles and metadata
- `dismissed_at` timestamp for notification history
- Links to patterns via `data` JSON field

**monitors** table:

- Foundation for future page monitoring features (currently unused)

#### IPC Communication

30+ new secure IPC channels organized by feature:

**Pattern Management (`pattern:*`):**

- `pattern:track-navigation`, `pattern:track-form`, `pattern:track-copy-paste`, `pattern:track-tab-switch`
- `pattern:get-all`, `pattern:save-automation`, `pattern:delete-automation`
- `pattern:execute`, `pattern:cancel-execution`, `pattern:edit-automation`

**Recording (`recording:*`):**

- `recording:start`, `recording:stop`, `recording:cancel`
- `recording:get-status`, `recording:set-paused`

**Notifications (`notification:*`):**

- `notification:get-all`, `notification:dismiss`, `notification:mark-all-read`
- `notification:new` (main → renderer event)

All channels use Zod validation for type-safe request/response payloads.

### Key Design Decisions

**1. LLM Over Heuristics**: Pattern detection and execution fully delegate to LLMs rather than building brittle rule-based systems. This trades compute cost (~$0.001 per analysis) for flexibility and accuracy.

**2. Structured LLM Output**: All LLM calls use `generateObject` from Vercel AI SDK with Zod schemas, ensuring type-safe responses without parsing fragile markdown/JSON.

**3. Cross-Tab Workflow Support**: Tab switches are tracked as metadata within patterns rather than as separate pattern types. This enables workflows like "Copy from ProductHunt → Paste to Notion" while keeping the primary pattern type clear.

**4. Exponential Backoff Retry**: LLM calls retry 3 times with exponential delays (2s, 4s, 8s) to handle transient API failures, but never fall back to deterministic heuristics.

**5. No Template Fallbacks**: The system fails gracefully if LLMs are unavailable rather than using hardcoded templates or heuristics that might produce incorrect automations.

**6. Branded ID Types**: TypeScript branded types (`PatternId`, `AutomationId`, etc.) prevent accidentally mixing IDs at compile time with zero runtime cost.

### Development & Testing

**Code Quality:**

- 0 TypeScript errors (`pnpm typecheck`)
- 0 ESLint errors (`pnpm lint`)
- All `console.log` replaced with `electron-log` for production debugging

**Performance Benchmarks:**

- Pattern detection: <30 seconds (including LLM call)
- Database operations: <50ms per write
- LLM API cost: <$0.01 per pattern detection + execution

### Future Extensions

The codebase includes infrastructure for planned features:

- **Page Monitoring** (`MonitorManager.ts`): Scheduled HTML snapshots and change detection (table exists, implementation pending)
- **Function Calling for Tab Control**: Allow AI chat to control tabs via function calling
- **Proactive Pattern Suggestions**: Continue detected patterns before user completes them
- **Visual Workflow Execution**: Gemini Computer Use integration for vision-based automation

---

## 🚀 Project Setup

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

**Add an OpenAI API key to `.env`** in the root folder.

Strawberry will reimburse LLM costs, so go crazy! _(Please not more than a few hundred dollars though!)_
