import { Mutex } from "async-mutex";
const BASE_URL = "http://localhost:8787";
declare global {
  interface Window {
    electronAPI: {
      requestPath: () => void;
      onSetPath: (callback: (data: { path: string, remote: string }) => void) => void;
    };
  }
}

let ws: WebSocket | null = null;
let remote: string | null = null;
let path: string | null = null;

// Set up connection and session
const pc = new RTCPeerConnection({
  iceServers: [
    {
      urls: 'stun:stun.cloudflare.com:3478'
    }
  ],
  bundlePolicy: 'max-bundle'
});

const localStream = await navigator.mediaDevices.getUserMedia({
  audio: true
});

// TODO: handle different tracks?
const track = localStream.getTracks()[0];
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

console.log("Connected!");

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
  const audio = new Audio();
  audio.srcObject = event.streams[0];
  audio.autoplay = true;

  document.getElementById("audios")!.appendChild(audio);
};

window.electronAPI.onSetPath((path) => {
  if (remote !== path.remote) {
    remote = path.remote;
    ws?.close();
    ws = null;
  }

  if (ws === null) {
    setUpWebSocket();
  }
});

// We're ready to go! Request a path from the extension to 
// set up the websocket
window.electronAPI.requestPath();

const setUpWebSocket = () => {
  if (!sessionId || !trackData.trackName || !remote) return;

  const wsParams = new URLSearchParams();
  wsParams.set("sessionId", sessionId);
  wsParams.set("trackId", trackData.trackName);
  wsParams.set("remote", remote);
  ws = new WebSocket(`${BASE_URL}/websocket?${wsParams.toString()}`);
  ws.onopen = () => {
    console.log("WebSocket connected!");
    if (path) {
      ws?.send(JSON.stringify({
        command: "set_path",
        path
      }));
    }
  };

  const activeSessionsMutex = new Mutex();

  ws.onmessage = async ev => {
    const data = JSON.parse(ev.data);
    console.log(data.command);
    if (data.command === "active_sessions") {
      activeSessionsMutex.runExclusive(async () => {
        const tracksToConnect = [];
        for (const session of data.sessions) {
          if (sessionId === session.id) continue;
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
    }
  };
};
