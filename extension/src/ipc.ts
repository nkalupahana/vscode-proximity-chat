import { z } from "zod";

const requestPathMessage = z.object({
  command: z.literal("request_path")
});

const muteStatusMessage = z.object({
  command: z.literal("mute_status"),
  muted: z.boolean()
});

const deafenStatusMessage = z.object({
  command: z.literal("deafen_status"),
  deafened: z.boolean()
});

const debugMessage = z.object({
  command: z.literal("debug"),
  message: z.string()
});

const infoMessage = z.object({
  command: z.literal("info"),
  message: z.string()
});

const errorMessage = z.object({
  command: z.literal("error"),
  message: z.string()
});

export const extensionIncomingMessageSchema = z.discriminatedUnion("command", [
  requestPathMessage,
  muteStatusMessage,
  deafenStatusMessage,
  debugMessage,
  infoMessage,
  errorMessage
]);

export type ExtensionIncomingMessage = z.infer<typeof extensionIncomingMessageSchema>;

const setPathMessage = z.object({
  command: z.literal("set_path"),
  path: z.string().nullable(),
  remote: z.string().nullable()
});

export type SetPathMessage = z.infer<typeof setPathMessage>;

const muteMessage = z.object({
  command: z.literal("mute")
});

const deafenMessage = z.object({
  command: z.literal("deafen")
});

export const extensionOutgoingMessageSchema = z.discriminatedUnion("command", [
  setPathMessage,
  muteMessage,
  deafenMessage
]);

export type ExtensionOutgoingMessage = z.infer<typeof extensionOutgoingMessageSchema>;