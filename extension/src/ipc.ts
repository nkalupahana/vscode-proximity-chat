import { z } from "zod";

const requestPathMessage = z.object({
  command: z.literal("request_path")
});

const requestNameMessage = z.object({
  command: z.literal("request_name")
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

const activeSessionsMessage = z.object({
  command: z.literal("active_sessions"),
  sessionId: z.string(),
  path: z.string(),
  sessions: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      prettyPath: z.string(),
      name: z.string(),
      distance: z.number()
    })
  )
});

export type ActiveSessionsMessage = z.infer<typeof activeSessionsMessage>;

const resetActiveSessionsMessage = z.object({
  command: z.literal("reset_active_sessions")
});

export const extensionIncomingMessageSchema = z.discriminatedUnion("command", [
  requestPathMessage,
  requestNameMessage,
  muteStatusMessage,
  deafenStatusMessage,
  debugMessage,
  infoMessage,
  errorMessage,
  activeSessionsMessage,
  resetActiveSessionsMessage
]);

export type ExtensionIncomingMessage = z.infer<typeof extensionIncomingMessageSchema>;

const setPathMessage = z.object({
  command: z.literal("set_path"),
  path: z.string().nullable(),
  prettyPath: z.string().nullable(),
  remote: z.string().nullable()
});

export type SetPathMessage = z.infer<typeof setPathMessage>;

const setNameMessage = z.object({
  command: z.literal("set_name"),
  name: z.string()
});

export type SetNameMessage = z.infer<typeof setNameMessage>;

const muteMessage = z.object({
  command: z.literal("mute")
});

const deafenMessage = z.object({
  command: z.literal("deafen")
});

export const extensionOutgoingMessageSchema = z.discriminatedUnion("command", [
  setPathMessage,
  setNameMessage,
  muteMessage,
  deafenMessage
]);

export type ExtensionOutgoingMessage = z.infer<typeof extensionOutgoingMessageSchema>;