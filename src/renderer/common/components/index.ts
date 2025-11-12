/**
 * Component Library
 *
 * Reusable UI components for Blueberry Browser
 * All components support dark mode via Tailwind CSS classes
 */

/**
 * Badge - Notification count indicator with severity levels
 * Features: count display (99+ for large counts), pulse animation, severity colors (info/warning/error)
 * @example
 * <Badge count={5} severity="error" pulse />
 */
export { Badge } from "./Badge";

/**
 * Button - Versatile button component with variants and states
 * Features: multiple variants (default/destructive/outline/secondary/ghost/link),
 * size variants (xs/sm/default/lg/icon), loading state with spinner, disabled state
 * @example
 * <Button variant="destructive" loading onClick={handleClick}>Delete</Button>
 */
export { Button } from "./Button";

/**
 * buttonVariants - Button styling variants using class-variance-authority
 * Used internally by Button component, exported for extending button styles
 */
export { buttonVariants } from "./buttonVariants";

/**
 * Modal - Dialog component with backdrop and close controls
 * Features: backdrop click to close, ESC key support, body scroll prevention,
 * customizable header/footer, dark mode support
 * @example
 * <Modal isOpen={open} onClose={() => setOpen(false)} title="Confirm Action">
 *   Are you sure?
 * </Modal>
 */
export { Modal } from "./Modal";

/**
 * Panel - Collapsible panel component for sidebar sections
 * Features: collapsible header with chevron icon, scrollable content area,
 * optional action buttons, dark mode support
 * @example
 * <Panel title="Settings" defaultExpanded={true}>
 *   <div>Panel content</div>
 * </Panel>
 */
export { Panel } from "./Panel";

/**
 * Toast - Temporary alert notification component
 * Features: auto-dismiss with configurable duration, toast types (info/success/warning/error),
 * slide-in animation, close button, dark mode support
 * @example
 * <Toast type="success" message="Saved successfully!" onClose={handleClose} />
 */
export { Toast, ToastContainer } from "./Toast";
