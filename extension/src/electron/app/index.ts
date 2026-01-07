import { Mutex } from "async-mutex";
import { getPathDistance } from "./utils";
import { ActiveSessionsMessage, type SetPathMessage } from "../../ipc";
import { ActiveTracksMessage, WebSocketMessage, websocketMessageSchema } from "./ws";

const BASE_URL = "https://prox.nisa.la";
declare global {
  interface Window {
    electronAPI: {
      onSetPath: (callback: (data: SetPathMessage) => void) => void;
      onMute: (callback: () => boolean) => void;
      onDeafen: (callback: () => boolean) => void;
      requestPath: () => void;
      debug: (message: string) => void;
      info: (message: string) => void;
      error: (message: string) => never;
      activeSessions: (message: Omit<ActiveSessionsMessage, "command">) => void;
      resetActiveSessions: () => void;
    };
  }
}

let ws: WebSocket | null = null;
let remote: string | null = null;
let path: string | null = null;
let lastActiveTracksMessage: ActiveTracksMessage | null = null;
let pendingStreamIdToTrackId: Record<string, string> = {};
let activeTracks: Record<string, HTMLAudioElement> = {};
let deafened = false;

const adjustVolumeOfExistingTracks = () => {
  if (!path || !lastActiveTracksMessage || deafened) {
    for (const trackId in activeTracks) {
      activeTracks[trackId].volume = 0;
    }
    return;
  }

  for (const session of lastActiveTracksMessage.sessions) {
    if (!(session.trackId in activeTracks)) continue;
    const dist = getPathDistance(session.path, path);
    const DISTANCE_TO_VOLUME = {
      0: 1,
      1: 0.6,
      2: 0.1
    } as Record<number, number>;
    const volume = DISTANCE_TO_VOLUME[dist] ?? 0;
    activeTracks[session.trackId].volume = volume;
  }
};

const updateExtensionActiveSessions = () => {
  if (!lastActiveTracksMessage || !path || !sessionId) {
    window.electronAPI.resetActiveSessions();
    return;
  }

  window.electronAPI.activeSessions({
    sessionId,
    path,
    sessions: lastActiveTracksMessage.sessions.map(session => {
      return {
        id: session.id,
        path: session.path,
        name: "Anonymous", // TODO: allow setting real names
        distance: getPathDistance(session.path, path!)
      };
    })
  });
};

window.electronAPI.onDeafen(() => {
  deafened = !deafened;
  adjustVolumeOfExistingTracks();

  return deafened;
});

// Set up connection and session
const pc = new RTCPeerConnection({
  iceServers: [
    {
      urls: 'stun:stun.cloudflare.com:3478'
    }
  ],
  bundlePolicy: 'max-bundle'
});

let localStream: MediaStream;
try {
  localStream = await navigator.mediaDevices.getUserMedia({
    audio: true
  });
} catch (e) {
  if (e instanceof DOMException && e.name === "NotAllowedError") {
    window.electronAPI.error("Permission denied to use microphone. Please grant permission to Visual Studio Code and try again.");
  } else if (e instanceof Error) {
    window.electronAPI.error(`Failed to get microphone (${e.name}, ${e.message}), exiting.`);
  } else {
    window.electronAPI.error(`Failed to get microphone, exiting. ${e}`);
  }
}

// TODO: handle different tracks?
const track = localStream.getTracks()[0];
window.electronAPI.onMute(() => {
  track.enabled = !track.enabled;

  const muted = !track.enabled;
  return muted;
});
const transceiver = pc.addTransceiver(track, {
  direction: 'sendonly'
});

await pc.setLocalDescription(await pc.createOffer());
const sessionResponse = await fetch(`${BASE_URL}/session`, {
  method: 'POST',
  body: JSON.stringify({
    sdp: pc.localDescription!.sdp
  })
});

const session = await sessionResponse.json();
const sessionId = session.sessionId;
await pc.setRemoteDescription(
  new RTCSessionDescription(session.sessionDescription)
);

await new Promise<void>((resolve, reject) => {
  pc.addEventListener('iceconnectionstatechange', ev => {
    if ((ev.target as RTCPeerConnection).iceConnectionState === 'connected') {
      resolve();
    }
    setTimeout(reject, 5000, 'connect timeout');
  });
});

window.electronAPI.debug("Connected!");

// Send track
await pc.setLocalDescription(await pc.createOffer());
const trackData = {
  location: 'local',
  mid: transceiver.mid,
  trackName: transceiver.sender.track!.id
};
const trackResponse = await fetch(`${BASE_URL}/tracks/send`, {
  method: 'POST',
  body: JSON.stringify({
    sessionId,
    sdp: pc.localDescription!.sdp,
    track: trackData
  })
});
const trackResponseData = await trackResponse.json();

await pc.setRemoteDescription(
  new RTCSessionDescription(trackResponseData.sessionDescription)
);

// Prepare for receiving tracks
pc.ontrack = event => {
  const stream = event.streams[0];
  const trackId = pendingStreamIdToTrackId[stream.id];
  if (!trackId) {
    window.electronAPI.debug("Received stream that was not known to be requested");
    return;
  }

  if (activeTracks[trackId]) {
    window.electronAPI.debug("Received track that is already active, ignoring.");
    return;
  }

  const audio = new Audio();
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.setAttribute("data-track-id", trackId);

  activeTracks[trackId] = audio;
  adjustVolumeOfExistingTracks();
  document.getElementById("audios")!.appendChild(audio);
};

const setPath = (path: string) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    command: "set_path",
    path
  }));
};

window.electronAPI.onSetPath((newPath) => {
  window.electronAPI.debug("Received path: " + JSON.stringify(newPath));
  if (remote !== newPath.remote) {
    remote = newPath.remote;
    ws?.close();
    ws = null;
  }

  path = newPath.path;

  if (path !== null) {
    if (ws === null) {
      setUpWebSocket();
    }
    setPath(path);
    adjustVolumeOfExistingTracks();
  } else {
    window.electronAPI.resetActiveSessions();
  }
});

// We're ready to go! Request a path from the extension to 
// set up the websocket
window.electronAPI.requestPath();

const activeSessionsMutex = new Mutex();

const setUpWebSocket = () => {
  if (!sessionId || !trackData.trackName || !remote) return;

  const wsParams = new URLSearchParams();
  wsParams.set("sessionId", sessionId);
  wsParams.set("trackId", trackData.trackName);
  wsParams.set("remote", remote);
  ws = new WebSocket(`${BASE_URL}/websocket?${wsParams.toString()}`);
  ws.onopen = () => {
    window.electronAPI.debug("WebSocket connected!");
    if (path) {
      setPath(path);
    } else {
      window.electronAPI.requestPath();
    }
  };

  ws.onmessage = async ev => {
    let message: WebSocketMessage;
    try {
      const data = JSON.parse(ev.data);
      message = websocketMessageSchema.parse(data);
    } catch (e: any) {
      window.electronAPI.debug("Failed to parse websocket message: " + ev.data);
      window.electronAPI.debug(e.message);
      return;
    }

    if (message.command === "active_sessions") {
      activeSessionsMutex.runExclusive(async () => {
        lastActiveTracksMessage = message;
        updateExtensionActiveSessions();
        adjustVolumeOfExistingTracks();
        const tracksToConnect = [];
        for (const session of message.sessions) {
          if (sessionId === session.id) continue;
          if (session.trackId in activeTracks) continue;

          tracksToConnect.push({
            location: "remote",
            sessionId: session.id,
            trackName: session.trackId
          });
        }

        if (tracksToConnect.length) {
          const trackResponse = await fetch(`${BASE_URL}/tracks/receive`, {
            method: 'POST',
            body: JSON.stringify({
              sessionId,
              tracks: tracksToConnect
            })
          });

          // TODO: handle error
          if (!trackResponse.ok) { }
          const trackResponseData = await trackResponse.json();

          pendingStreamIdToTrackId = {
            ...pendingStreamIdToTrackId,
            ...trackResponseData.streamIdToTrackId
          };

          await pc.setRemoteDescription(
            new RTCSessionDescription(
              trackResponseData.sessionDescription
            )
          );
          await pc.setLocalDescription(await pc.createAnswer());
          await fetch(`${BASE_URL}/renegotiate`, {
            method: 'POST',
            body: JSON.stringify({
              sessionId,
              sdp: pc.localDescription!.sdp
            })
          });
        }
      });
    } else if (message.command === 'track_closed') {
      if (message.trackId in activeTracks) {
        activeTracks[message.trackId].pause();
        activeTracks[message.trackId].remove();
        delete activeTracks[message.trackId];
      }
    }
  };
};
