import { z } from 'zod';
import { tr } from 'zod/v4/locales';

export const sessionSchema = z.object({
  sdp: z.string(),
});

const offerSessionDescriptionSchema = z.object({
  type: z.literal("offer"),
  sdp: z.string()
})

const answerSessionDescriptionSchema = z.object({
  type: z.literal("answer"),
  sdp: z.string()
})

export const cloudflareSessionSchema = z.object({
  sessionId: z.string(),
  sessionDescription: answerSessionDescriptionSchema,
});

export const cloudflareSendTrackSchema = z.object({
  sessionDescription: answerSessionDescriptionSchema
});

export const cloudflareReceiveTrackSchema = z.object({
  requiresImmediateRenegotiation: z.literal(true),
  tracks: z.object({
    sessionId: z.string(),
    trackName: z.string(),
    mid: z.string(),
  }).array(),
  sessionDescription: offerSessionDescriptionSchema
})

export const sendTrackSchema = z.object({
  sessionId: z.string(),
  sdp: z.string(),
  track: z.object({
    location: z.literal("local"),
    mid: z.string(),
    trackName: z.string()
  })
});

export const receiveTracksSchema = z.object({
  sessionId: z.string(),
  tracks: z.object({
    location: z.literal("remote"),
    sessionId: z.string(),
    trackName: z.string()
  }).array()
})

export const renegotiateSchema = z.object({
  sessionId: z.string(),
  sdp: z.string()
})

const setPathMessage = z.object({
  command: z.literal("set_path"),
  path: z.string()
})

const setNameMessage = z.object({
  command: z.literal("set_name"),
  name: z.string()
})

export const messageSchema = z.discriminatedUnion("command", [setPathMessage, setNameMessage]);