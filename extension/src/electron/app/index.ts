import { Mutex } from "async-mutex";
const BASE_URL = "http://localhost:8788";

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
})

await pc.setLocalDescription(await pc.createOffer());
const response = await fetch(`${BASE_URL}/session`, {
  method: 'POST',
  body: JSON.stringify({
    sdp: pc.localDescription!.sdp
  })
});

const session = await response.json();
await pc.setRemoteDescription(
  new RTCSessionDescription(session.sessionDescription)
);

await new Promise<void>((resolve, reject) => {
  pc.addEventListener('iceconnectionstatechange', ev => {
    if (ev.target!.iceConnectionState === 'connected') {
      resolve();
    }
    setTimeout(reject, 5000, 'connect timeout');
  });
});

console.log("Connected!");

const trackData = {
  location: 'local',
  mid: transceiver.mid,
  trackName: transceiver.sender.track.id
};

const rtcMutex = new Mutex();

await rtcMutex.acquire(); // released by set_track_result
await pc.setLocalDescription(await pc.createOffer());

const ws = new WebSocket(`${BASE_URL}/websocket?sessionId=${session.sessionId}`);
ws.onopen = () => {
  console.log("WebSocket connected!");
  ws.send(JSON.stringify({
    command: "set_track",
    sdp: pc.localDescription!.sdp,
    track: trackData
  }));
};

ws.onmessage = async ev => {
  const data = JSON.parse(ev.data);
  console.log(data.command);
  if (data.command === "set_track_result") {
    await pc.setRemoteDescription(
      new RTCSessionDescription(data.sessionDescription)
    );
    rtcMutex.release();
  } else if (data.command === "active_tracks") {
    for (const track of data.tracks) {
      if (track.sessionId === session.sessionId) continue;
      console.log("TODO: Connect to track", track);
    }
  }
};