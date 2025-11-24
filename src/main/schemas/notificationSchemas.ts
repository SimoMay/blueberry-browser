import { z } from "zod";
import { createNotificationId } from "../types/brandedTypes";

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
 * Uses .transform() to return branded NotificationId for type safety
 */
export const DismissNotificationSchema = z.object({
  notificationId: z
    .uuid({ message: "Invalid notification ID format" })
    .transform(createNotificationId),
});

/**
 * Get notifications input schema
 */
export const GetNotificationsSchema = z.object({
  type: NotificationTypeSchema.optional(),
});

/**
 * Type exports for TypeScript
 * Branded types are automatically inferred from .transform() now
 */
export type CreateNotificationInput = z.infer<typeof CreateNotificationSchema>;
export type DismissNotificationInput = z.infer<
  typeof DismissNotificationSchema
>;
export type GetNotificationsInput = z.infer<typeof GetNotificationsSchema>;
