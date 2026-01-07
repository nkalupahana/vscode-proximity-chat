import { DurableObject } from 'cloudflare:workers';
import { cloudflareSessionSchema, sendTrackSchema, messageSchema, sessionSchema, receiveTracksSchema, renegotiateSchema, cloudflareReceiveTrackSchema, cloudflareSendTrackSchema } from './schema';
import sdp from "sdp";

const getBasePath = (appId: string) => {
  return `https://rtc.live.cloudflare.com/v1/apps/${appId}`;
}

const createSession = async (request: Request, env: Env) => {
  const data = sessionSchema.parse(await request.json());

  const response = await fetch(`${getBasePath(env.APP_ID)}/sessions/new`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${env.APP_TOKEN}`,
    },
    body: JSON.stringify({
      sessionDescription: {
        type: 'offer',
        sdp: data.sdp,
      },
    }),
  });

  // TODO: handle errors
  if (!response.ok) {}
  return new Response(JSON.stringify(cloudflareSessionSchema.parse(await response.json())));
}

const sendTrack = async (request: Request, env: Env) => {
  const data = sendTrackSchema.parse(await request.json());

  const response = await fetch(`${getBasePath(env.APP_ID)}/sessions/${data.sessionId}/tracks/new`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${env.APP_TOKEN}`,
    },
    body: JSON.stringify({
      sessionDescription: {
        type: 'offer',
        sdp: data.sdp,
      },
      tracks: [data.track]
    }),
  });

  // TODO: handle errors
  if (!response.ok) {}
  return new Response(JSON.stringify(cloudflareSendTrackSchema.parse(await response.json())));
}

const receiveTracks = async (request: Request, env: Env) => {
  const data = receiveTracksSchema.parse(await request.json());

  const response = await fetch(`${getBasePath(env.APP_ID)}/sessions/${data.sessionId}/tracks/new`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${env.APP_TOKEN}`,
    },
    body: JSON.stringify({
      tracks: data.tracks
    }),
  });

  // TODO: handle errors
  if (!response.ok) {}
  const datap = await response.json();
  const responseJson = cloudflareReceiveTrackSchema.parse(datap);
  const midToTrackId: Record<string, string> = {};
  for (const track of responseJson.tracks) {
    midToTrackId[track.mid] = track.trackName;
  }
  const streamIdToTrackId: Record<string, string> = {};
  const sections = sdp.splitSections(responseJson.sessionDescription.sdp);
  for (const section of sections) {
    if (sdp.getKind(section) !== "audio") continue;
    if (sdp.getDirection(section, section) !== "sendonly") continue;

    const mid = sdp.getMid(section);
    if (!(mid in midToTrackId)) continue;

    const msid = sdp.parseMsid(section);
    streamIdToTrackId[msid.stream] = midToTrackId[mid]!;
  }
  return new Response(JSON.stringify({...responseJson, streamIdToTrackId }));
}

const renegotiate = async (request: Request, env: Env) => {
  const data = renegotiateSchema.parse(await request.json());

  const response = await fetch(`${getBasePath(env.APP_ID)}/sessions/${data.sessionId}/renegotiate`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${env.APP_TOKEN}`,
    },
    body: JSON.stringify({
      sessionDescription: {
        type: "answer",
        sdp: data.sdp
      }
    }),
  });

  // TODO: handle errors
  if (!response.ok) {}
  return new Response();
}

const createWebSocket = async (request: Request, env: Env) => {
  // Expect to receive a WebSocket Upgrade request.
  // If there is one, accept the request and return a WebSocket Response.
  const upgradeHeader = request.headers.get('Upgrade');
  if (!upgradeHeader || upgradeHeader !== 'websocket') {
    return new Response('Expected Upgrade: websocket', {
      status: 426,
    });
  }

  const url = new URL(request.url);
  const remote = url.searchParams.get("remote");

  if (!remote) {
    return new Response("Missing remote", { status: 400 });
  }

  const stub = env.WEBSOCKET_SERVER.getByName(remote);
  return stub.fetch(request);
}

// Worker
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Create session request
    if (url.pathname === '/session' && request.method === 'POST') {
      return createSession(request, env);
    }

    if (url.pathname === '/tracks/send' && request.method === 'POST') {
      return sendTrack(request, env);
    }

    if (url.pathname === '/tracks/receive' && request.method === 'POST') {
      // TODO: handle tracks to receive
      return receiveTracks(request, env);
    }

    if (url.pathname === '/renegotiate') {
      return renegotiate(request, env);
    }

    if (url.pathname === '/websocket' && request.method === 'GET') {
      return createWebSocket(request, env);
    }

    return new Response(null, { status: 404 });
  },
};

// Durable Object
export class WebSocketServer extends DurableObject {
  // Keeps track of all WebSocket connections
  // When the DO hibernates, gets reconstructed in the constructor
  sessions: Map<WebSocket, { [key: string]: string }>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sessions = new Map();

    // Wake up hibernating WebSockets
    this.ctx.getWebSockets().forEach((ws) => {
      let attachment = ws.deserializeAttachment();
      if (attachment) {
        this.sessions.set(ws, { ...attachment });
      }
    });

    // Auto response to pings (no wake)
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);
    const url = new URL(request.url);
    const sessionId = url.searchParams.get("sessionId");
    if (!sessionId) {
      return new Response("Missing sessionId", { status: 400 });
    }
    const trackId = url.searchParams.get("trackId");
    if (!trackId) {
      return new Response("Missing trackId", { status: 400 });
    }

    // Accept the WebSocket connection with hibernation
    this.ctx.acceptWebSocket(server);

    const data = { id: sessionId, trackId };
    server.serializeAttachment(data);
    this.sessions.set(server, data);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  private sendActiveSessions() {
    // Collect all active sessions
    const sessions = [];
    for (const [_, session] of this.sessions) {
      if (!session.trackId) continue;
      if (!session.path) continue;
      sessions.push({
        id: session.id,
        trackId: session.trackId,
        path: session.path
      });
    }

    // Send active track data to all clients
    for (const [ws, _] of this.sessions) {
      ws.send(JSON.stringify({
        command: "active_sessions",
        sessions
      }));
    }
  }

  async webSocketMessage(ws: WebSocket, messageStr: string) {
    // Get the session associated with the WebSocket connection.
    const session = this.sessions.get(ws)!;
    const message = messageSchema.parse(JSON.parse(messageStr));
    if (message.command === "set_path") {
      const newAttachment = { ...session, path: message.path };
      ws.serializeAttachment(newAttachment);
      this.sessions.set(ws, newAttachment);

      this.sendActiveSessions();
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    if (this.sessions.has(ws)) {
      this.sessions.delete(ws);
      this.sendActiveSessions();
    }

    ws.close(code, 'Durable Object is closing WebSocket');
  }
}