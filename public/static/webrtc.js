/**
 * WebRTC full mesh (voice + video) with Socket.IO signaling.
 */
(function () {
  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  const peers = new Map();
  let localStream = null;
  let socketRef = null;
  let lastMyId = null;
  let lastPeerIds = null;

  function getVideoEl(i) {
    return document.querySelector(`.video-face[data-player="${i}"]`);
  }

  function setPlaceholder(i, player, myIndex) {
    const wrap = document.querySelector(`.video-face-wrap[data-player="${i}"]`);
    if (!wrap) return;
    const ph = wrap.querySelector(".video-placeholder");
    const v = getVideoEl(i);
    if (!player) {
      if (ph) ph.textContent = "Waiting";
      if (v) {
        v.srcObject = null;
        v.hidden = true;
      }
      return;
    }
    if (player.isAI) {
      if (ph) ph.textContent = "AI";
      if (v) {
        v.srcObject = null;
        v.hidden = true;
      }
      return;
    }
    if (typeof myIndex === "number" && i === myIndex) {
      if (ph) ph.textContent = "";
      return;
    }
    if (ph) ph.textContent = "";
    if (v) {
      v.srcObject = null;
      v.hidden = true;
    }
  }

  async function ensureLocalStream() {
    if (localStream) return localStream;
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 360 } },
      audio: true,
    });
    return localStream;
  }

  function closePeer(remoteId) {
    const idx = lastPeerIds?.indexOf(remoteId);
    const pc = peers.get(remoteId);
    if (!pc) return;
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.close();
    peers.delete(remoteId);
    if (idx >= 0) {
      const v = getVideoEl(idx);
      if (v) {
        v.srcObject = null;
        v.hidden = true;
      }
    }
  }

  function closeAllPeers() {
    for (const id of peers.keys()) closePeer(id);
  }

  function attachLocalToSlot(myIndex) {
    if (localStream == null || myIndex < 0 || myIndex > 3) return;
    const v = getVideoEl(myIndex);
    if (!v) return;
    v.srcObject = localStream;
    v.muted = true;
    v.playsInline = true;
    v.hidden = false;
    v.play().catch(() => {});
    const wrap = document.querySelector(`.video-face-wrap[data-player="${myIndex}"]`);
    const ph = wrap?.querySelector(".video-placeholder");
    if (ph) ph.textContent = "";
  }

  function onRemoteTrack(remoteId, stream, peerIds) {
    const idx = peerIds.indexOf(remoteId);
    if (idx < 0) return;
    const v = getVideoEl(idx);
    if (!v) return;
    v.srcObject = stream;
    v.muted = false;
    v.playsInline = true;
    v.hidden = false;
    v.play().catch(() => {});
    const wrap = document.querySelector(`.video-face-wrap[data-player="${idx}"]`);
    const ph = wrap?.querySelector(".video-placeholder");
    if (ph) ph.textContent = "";
  }

  async function setupPeer(remoteId, socket, polite) {
    if (peers.has(remoteId)) return;
    if (!localStream) return;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    peers.set(remoteId, pc);

    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

    pc.onicecandidate = (e) => {
      if (e.candidate && socketRef) {
        socketRef.emit("webrtc:signal", {
          to: remoteId,
          signal: { type: "ice", candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate },
        });
      }
    };

    pc.ontrack = (e) => {
      const s = e.streams[0];
      if (s) onRemoteTrack(remoteId, s, lastPeerIds || []);
    };

    if (polite) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit("webrtc:signal", {
        to: remoteId,
        signal: { type: "offer", sdp: offer.sdp },
      });
    }
  }

  async function handleSignal({ from, signal }, socket) {
    if (!signal || !from) return;
    if (!localStream) {
      try {
        await ensureLocalStream();
      } catch {
        return;
      }
    }

    let pc = peers.get(from);
    if (!pc) {
      pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      peers.set(from, pc);
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
      pc.onicecandidate = (e) => {
        if (e.candidate && socketRef) {
          socketRef.emit("webrtc:signal", {
            to: from,
            signal: { type: "ice", candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate },
          });
        }
      };
      pc.ontrack = (e) => {
        const s = e.streams[0];
        if (s) onRemoteTrack(from, s, lastPeerIds || []);
      };
    }

    if (signal.type === "offer" && signal.sdp) {
      await pc.setRemoteDescription({ type: "offer", sdp: signal.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit("webrtc:signal", {
        to: from,
        signal: { type: "answer", sdp: answer.sdp },
      });
    } else if (signal.type === "answer" && signal.sdp) {
      await pc.setRemoteDescription({ type: "answer", sdp: signal.sdp });
    } else if (signal.type === "ice" && signal.candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
      } catch {
        /* ignore */
      }
    }
  }

  async function syncPeers(peerSocketIds, myId, socket) {
    lastPeerIds = peerSocketIds;
    lastMyId = myId;

    const remotes = peerSocketIds.filter((id) => id && id !== myId);

    for (const id of peers.keys()) {
      if (!remotes.includes(id)) closePeer(id);
    }

    try {
      await ensureLocalStream();
    } catch (e) {
      console.warn("Camera/mic:", e);
      return;
    }

    const myIdx = peerSocketIds.indexOf(myId);
    if (myIdx >= 0) attachLocalToSlot(myIdx);

    if (remotes.length === 0) return;

    for (const remoteId of remotes) {
      if (peers.has(remoteId)) continue;
      const polite = myId < remoteId;
      await setupPeer(remoteId, socket, polite);
    }
  }

  window.WebRtcGame = {
    init(socket) {
      socketRef = socket;
      socket.on("webrtc:signal", (payload) => handleSignal(payload, socket));
    },

    async update(state) {
      if (!state.peerSocketIds) return;
      const myId = socketRef?.id;
      if (!myId) return;

      for (let i = 0; i < 4; i++) {
        setPlaceholder(i, state.players[i], state.myIndex);
      }

      const hasHumanPeer = state.peerSocketIds.some((id, i) => id && id !== myId && !state.players[i]?.isAI);

      try {
        if (hasHumanPeer) {
          await syncPeers(state.peerSocketIds, myId, socketRef);
        } else {
          closeAllPeers();
          await ensureLocalStream();
        }
      } catch (e) {
        console.warn("WebRTC sync", e);
      }

      attachLocalToSlot(state.myIndex);
    },

    stop() {
      closeAllPeers();
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
      }
      lastPeerIds = null;
      for (let i = 0; i < 4; i++) {
        const v = getVideoEl(i);
        if (v) {
          v.srcObject = null;
          v.hidden = true;
        }
      }
    },

    toggleMic() {
      if (!localStream) return false;
      const a = localStream.getAudioTracks()[0];
      if (!a) return false;
      a.enabled = !a.enabled;
      return a.enabled;
    },

    isMicEnabled() {
      const a = localStream?.getAudioTracks()[0];
      return a ? a.enabled : true;
    },
  };
})();
