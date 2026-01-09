import { Mutex } from "async-mutex";
import { getPathDistance, getVolume } from "./utils";
import { ActiveSessionsMessage, SetNameMessage, type SetPathMessage } from "../../ipc";
import { ActiveTracksMessage, WebSocketMessage, websocketMessageSchema } from "./ws";
import { chunk, set } from "lodash";

const BASE_URL = "https://prox.nisa.la";
const ONE_MINUTE = 60 * 1000;
declare global {
  interface Window {
    electronAPI: {
      onSetPath: (callback: (data: SetPathMessage) => void) => void;
      onSetName: (callback: (data: SetNameMessage) => void) => void;
      onMute: (callback: () => boolean) => void;
      onDeafen: (callback: () => boolean) => void;
      requestPath: () => void;
      requestName: () => void;
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
let prettyPath: string | null = null;
let lastActiveTracksMessage: ActiveTracksMessage | null = null;
let pendingStreamIdToTrackId: Record<string, string> = {};
let activeTracks: Record<string, HTMLAudioElement> = {};
let deafened = false;
let name = "";
let setToZeroVolumeAt: Record<string, number> = {};

window.electronAPI.onSetName((newName) => {
  name = newName.name;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      command: "set_name",
      name
    }));
  }
});

window.electronAPI.requestName();

const disconnectTrack = (trackId: string) => {
  window.electronAPI.debug("Disconnecting track: " + trackId);
  activeTracks[trackId].pause();
  activeTracks[trackId].remove();
  delete activeTracks[trackId];
};

setInterval(() => {
  for (const trackId in setToZeroVolumeAt) {
    if (Date.now() - setToZeroVolumeAt[trackId] > (ONE_MINUTE * 3)) {
      disconnectTrack(trackId);
    }
  }
}, ONE_MINUTE);

const adjustVolumeOfExistingTracks = () => {
  if (!path || !lastActiveTracksMessage || deafened) {
    for (const trackId in activeTracks) {
      activeTracks[trackId].volume = 0;
      setToZeroVolumeAt[trackId] = Date.now();
    }
    return;
  }

  for (const session of lastActiveTracksMessage.sessions) {
    if (!(session.trackId in activeTracks)) continue;
    const volume = getVolume(session.path, path);
    activeTracks[session.trackId].volume = volume;
    if (volume === 0) {
      setToZeroVolumeAt[session.trackId] = Date.now();
    } else {
      delete setToZeroVolumeAt[session.trackId];
    }
  }

  // Disconnect from everyone not in message (people who have disconnected entirely)
  const activeTrackIds = new Set(lastActiveTracksMessage.sessions.map(session => session.trackId));
  for (const trackId in activeTracks) {
    if (!activeTrackIds.has(trackId)) {
      disconnectTrack(trackId);
    }
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
        prettyPath: session.prettyPath,
        name: session.name ?? "Anonymous",
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
    window.electronAPI.debug("Received track that was not known to be requested");
    return;
  }

  if (activeTracks[trackId]) {
    window.electronAPI.debug("Received track that is already active, ignoring.");
    return;
  }
  
  window.electronAPI.debug("Connecting to track: " + trackId);

  const audio = new Audio();
  audio.srcObject = stream;
  audio.autoplay = true;
  audio.setAttribute("data-track-id", trackId);

  activeTracks[trackId] = audio;
  adjustVolumeOfExistingTracks();
  document.getElementById("audios")!.appendChild(audio);
};

const setPath = (path: string, prettyPath: string) => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({
    command: "set_path",
    path,
    prettyPath
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
  prettyPath = newPath.prettyPath;

  if (path !== null && prettyPath !== null) {
    if (ws === null) {
      setUpWebSocket();
    }
    setPath(path, prettyPath);
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
    if (path && prettyPath) {
      setPath(path, prettyPath);
    } else {
      window.electronAPI.requestPath();
    }
    if (name) {
      ws?.send(JSON.stringify({
        command: "set_name",
        name
      }));
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
          if (path && getVolume(session.path, path) === 0) continue;

          window.electronAPI.debug("Requesting track: " + session.trackId);
          tracksToConnect.push({
            location: "remote",
            sessionId: session.id,
            trackName: session.trackId
          });
        }

        if (tracksToConnect.length) {
          const trackChunks = chunk(tracksToConnect, 64);
          for (const trackChunk of trackChunks) {
            const trackResponse = await fetch(`${BASE_URL}/tracks/receive`, {
              method: 'POST',
              body: JSON.stringify({
                sessionId,
                tracks: trackChunk
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
        }
      });
    }
  };
};
