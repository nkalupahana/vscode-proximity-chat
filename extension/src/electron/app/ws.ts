import { z } from "zod";

const activeSessionsMessage = z.object({
  command: z.literal("active_sessions"),
  sessions: z.array(
    z.object({
      id: z.string(),
      trackId: z.string(),
      name: z.string().nullish(),
      path: z.string()
    })
  )
});

export type ActiveTracksMessage = z.infer<typeof activeSessionsMessage>;

export const websocketMessageSchema = z.discriminatedUnion("command", [
  activeSessionsMessage
]);

export type WebSocketMessage = z.infer<typeof websocketMessageSchema>;