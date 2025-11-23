import { z } from "zod";
import type { NotificationId } from "../types/brandedTypes";

/**
 * Notification type schema
 */
export const NotificationTypeSchema = z.enum(["pattern", "monitor", "system"]);

/**
 * Notification severity schema
 */
export const NotificationSeveritySchema = z.enum(["info", "warning", "error"]);

/**
 * Create notification input schema
 */
export const CreateNotificationSchema = z.object({
  type: NotificationTypeSchema,
  severity: NotificationSeveritySchema,
  title: z.string().min(1, { message: "Title is required" }),
  message: z.string().min(1, { message: "Message is required" }),
  data: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Dismiss notification input schema
 */
export const DismissNotificationSchema = z.object({
  notificationId: z
    .string()
    .uuid({ message: "Invalid notification ID format" }),
});

/**
 * Get notifications input schema
 */
export const GetNotificationsSchema = z.object({
  type: NotificationTypeSchema.optional(),
});

/**
 * Type exports for TypeScript (with branded types for type safety)
 */
export type CreateNotificationInput = z.infer<typeof CreateNotificationSchema>;

// Override Zod inference to use branded NotificationId
export type DismissNotificationInput = Omit<
  z.infer<typeof DismissNotificationSchema>,
  "notificationId"
> & {
  notificationId: NotificationId;
};

export type GetNotificationsInput = z.infer<typeof GetNotificationsSchema>;
