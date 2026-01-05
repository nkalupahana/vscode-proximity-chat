import { z } from "zod";

const activeSessionsMessage = z.object({
  command: z.literal("active_sessions"),
  sessions: z.array(
    z.object({
      id: z.string(),
      trackId: z.string(),
      path: z.string()
    })
  )
});

export type ActiveTracksMessage = z.infer<typeof activeSessionsMessage>;

const trackClosedMessage = z.object({
  command: z.literal("track_closed"),
  trackId: z.string()
});

export const websocketMessageSchema = z.discriminatedUnion("command", [
  activeSessionsMessage,
  trackClosedMessage
]);

export type WebSocketMessage = z.infer<typeof websocketMessageSchema>;