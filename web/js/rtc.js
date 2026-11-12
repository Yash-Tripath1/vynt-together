// Live viewfinders over WebRTC, peer-to-peer.
//
// The relay stays the signalling channel (SDP + ICE ride its control messages, which it
// already forwards with the sender's id) and keeps doing stills + strip + fallback
// frames. Only the live video moves here, P2P and encrypted (DTLS-SRTP by default).
//
// Deterministic negotiation: both peers exchange `rtc-hello` so each knows the other's
// server-assigned id, then the lexicographically smaller id makes the offer. Exactly one
// side offers -- no glare, no "who starts" race.

export function shouldOffer(myId, partnerId) {
  if (!myId || !partnerId) return false
  return String(myId) < String(partnerId)
}

/**
 * @param {object} options
 * @param {RTCIceServer[]} options.iceServers
 * @param {(msg:object)=>void} options.send push a signalling message through the relay
 * @param {(stream:MediaStream)=>void} options.onRemoteStream
 * @param {(state:RTCPeerConnectionState)=>void} options.onState
 */
export function createRtc({ iceServers, send, onRemoteStream, onState }) {
  let pc = null

  function ensurePc() {
    if (pc) return pc
    pc = new RTCPeerConnection({ iceServers })

    pc.onicecandidate = (ev) => {
      if (ev.candidate) send({ type: 'rtc-ice', candidate: ev.candidate.toJSON() })
    }
    pc.ontrack = (ev) => {
      if (ev.streams && ev.streams[0]) onRemoteStream(ev.streams[0])
    }
    pc.onconnectionstatechange = () => onState(pc.connectionState)

    return pc
  }

  async function addLocal(stream) {
    const conn = ensurePc()
    for (const track of stream.getTracks()) {
      // The viewfinder is people moving, not slides: prioritize motion and keep the
      // framerate steady, which is what makes it feel like a video call instead of a
      // stream of stills. All of this is best-effort (unsupported browsers ignore it).
      try {
        track.contentHint = 'motion'
      } catch {
        // contentHint not supported
      }
      const sender = conn.addTrack(track, stream)
      try {
        const params = sender.getParameters()
        params.degradationPreference = 'maintain-framerate'
        if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
        for (const encoding of params.encodings) {
          encoding.maxFramerate = 30
          encoding.maxBitrate = 1_500_000
        }
        sender.setParameters(params)
      } catch {
        // setParameters not supported or not yet negotiable
      }
    }
  }

  async function makeOffer() {
    const conn = ensurePc()
    await conn.setLocalDescription(await conn.createOffer())
    send({ type: 'rtc-offer', sdp: conn.localDescription })
  }

  async function handleSignal(msg) {
    try {
      if (msg.type === 'rtc-offer') {
        const conn = ensurePc()
        await conn.setRemoteDescription(msg.sdp)
        await conn.setLocalDescription(await conn.createAnswer())
        send({ type: 'rtc-answer', sdp: conn.localDescription })
      } else if (msg.type === 'rtc-answer') {
        if (pc) await pc.setRemoteDescription(msg.sdp)
      } else if (msg.type === 'rtc-ice') {
        if (pc && msg.candidate) await pc.addIceCandidate(msg.candidate)
      }
    } catch (error) {
      onState('failed')
    }
  }

  function close() {
    if (pc) {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      try {
        pc.close()
      } catch {
        // already closed
      }
      pc = null
    }
  }

  return { addLocal, makeOffer, handleSignal, close }
}
