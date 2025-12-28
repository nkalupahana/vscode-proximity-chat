import { z } from 'zod';

export const sessionSchema = z.object({
  sdp: z.string(),
});

const sessionDescriptionSchema = z.object({
  type: z.union([z.literal("offer"), z.literal("answer")]),
  sdp: z.string(),
});

export const cloudflareSessionSchema = z.object({
  sessionId: z.string(),
  sessionDescription: sessionDescriptionSchema,
});

export const cloudflareTrackSchema = z.object({
  sessionDescription: sessionDescriptionSchema
});

export const setTrackMessageSchema = z.object({
  command: z.literal("set_track"),
  sdp: z.string(),
  track: z.object({
    location: z.literal("local"),
    mid: z.string(),
    trackName: z.string()
  })
})

export const messageSchema = z.discriminatedUnion("command", [setTrackMessageSchema]);