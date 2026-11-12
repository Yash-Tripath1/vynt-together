// VYNT Together -- session orchestration.
//
// One page, hash-routed rooms (#/r/CODE). Each side sends its filtered viewfinder as a
// real WebRTC video track (Meet-style: hardware encoded, peer to peer), with a fast
// frame stream over the relay when video cannot connect. Full-res filtered stills land
// on the shutter. A "click together" countdown fires both shutters within one beat.

import { KIND, makeRoomCode, encodeFrame } from './codec.js'
import { createNet } from './net.js'
import { createRtc, shouldOffer } from './rtc.js'
import { createBooth, FILTERS } from './capture.js'
import { renderCollage, downloadCanvas } from './collage.js'

// Public STUN first, then the free OpenRelay TURN (UDP + TCP-443) so the video call
// still connects through symmetric NATs and networks where UDP never flows. For
// production, swap in your own TURN here (any coturn/Twilio/Metered credentials work).
const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

const $ = (sel) => document.querySelector(sel)

const els = {
  landing: $('#landing'),
  session: $('#session'),
  statusLed: $('#statusLed'),
  statusText: $('#statusText'),
  roomCode: $('#roomCode'),
  copyBtn: $('#copyBtn'),
  partnerPill: $('#partnerPill'),
  myCam: $('#myCam'),
  theirCam: $('#theirCam'),
  theirWait: $('#theirWait'),
  filterChips: $('#filterChips'),
  grain: $('#grain'),
  grainOut: $('#grainOut'),
  pixel: $('#pixel'),
  pixelOut: $('#pixelOut'),
  stamp: $('#stamp'),
  mirror: $('#mirror'),
  togetherBtn: $('#togetherBtn'),
  soloBtn: $('#soloBtn'),
  collageBtn: $('#collageBtn'),
  clearBtn: $('#clearBtn'),
  strip: $('#strip'),
  stripCount: $('#stripCount'),
  countdown: $('#countdown'),
  countNum: $('#countNum'),
  collageModal: $('#collageModal'),
  collageCanvas: $('#collageCanvas'),
  downloadBtn: $('#downloadBtn'),
  closeCollage: $('#closeCollage'),
  errorCard: $('#errorCard'),
  errorMsg: $('#errorMsg'),
  errorClose: $('#errorClose'),
  startBtn: $('#startBtn'),
}

const state = {
  room: null,
  myId: null,
  partnerId: null,
  partner: false,
  inSession: false,
  rtcMode: 'idle', // idle | connecting | live | frames
  photos: [], // { who:'me'|'them', blob, url, ts, selected }
  previewBusy: false,
  counting: false,
}

const remoteVideo = document.createElement('video')
remoteVideo.muted = true
remoteVideo.playsInline = true
remoteVideo.autoplay = true

let booth = null
let net = null
let rtc = null
let cameraStream = null
let cameraReady = false
let renderStarted = false
let previewTimer = null

// ---- helpers ----------------------------------------------------------------

function showError(message) {
  els.errorMsg.textContent = message
  els.errorCard.hidden = false
}

function setStatus(kind, text) {
  els.statusLed.className = `led ${kind}`
  els.statusText.textContent = text
}

function updatePartnerUI() {
  const link = state.rtcMode === 'live' ? 'VIDEO' : state.rtcMode === 'frames' ? 'FRAMES' : 'CONNECTED'
  els.partnerPill.textContent = state.partner ? link : 'WAITING'
  els.partnerPill.classList.toggle('on', state.partner)
  if (state.partner) setStatus('live', 'LIVE 2/2')
  else if (net && net.connected) setStatus('open', state.room ? 'connected' : 'relay up')
  if (!state.partner) els.theirWait.hidden = false
}

function teardownRtc() {
  if (rtc) {
    rtc.close()
    rtc = null
  }
  remoteVideo.srcObject = null
  state.rtcMode = 'idle'
  state.partnerId = null
}

// ---- routing ----------------------------------------------------------------

function currentRoom() {
  const m = location.hash.match(/^#\/r\/([A-Za-z0-9]{4,12})$/)
  return m ? m[1].toUpperCase() : null
}

function route() {
  const room = currentRoom()
  if (room) enterSession(room)
  else showLanding()
}

function showLanding() {
  // Leaving a session must actually leave: tell the room, drop the video call, and
  // turn the camera off.
  if (net && state.room) net.send({ type: 'leave' })
  teardownRtc()
  stopCamera()
  state.room = null
  state.partner = false
  state.inSession = false
  state.counting = false
  els.countdown.hidden = true
  els.session.hidden = true
  els.landing.hidden = false
  setStatus('', 'standby')
}

async function enterSession(room) {
  const firstTime = state.room !== room
  state.room = room
  state.inSession = true
  els.landing.hidden = true
  els.session.hidden = false
  els.roomCode.textContent = room

  if (firstTime) {
    clearPhotos(false) // a new session starts with a clean strip
    await startCamera()
    ensureNet()
    buildFilterChips()
  }
  if (net && net.connected) net.send({ type: 'join', room })
  updatePartnerUI()
}

// ---- camera + booth ----------------------------------------------------------

async function startCamera() {
  if (cameraReady) return
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = cameraStream
    await video.play()

    // Wait for real frames before rendering, so the pane never starts half-alive.
    for (let i = 0; i < 100 && !video.videoWidth; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!video.videoWidth) throw new Error('camera produced no frames')

    const [track] = cameraStream.getVideoTracks()
    if (track) {
      track.addEventListener('ended', () => {
        if (!state.inSession) return
        stopCamera()
        showError('Camera stopped. Reload the page to reconnect it.')
      })
    }

    booth = createBooth({ video, canvas: els.myCam })
    applyControlValues()
    cameraReady = true
    startRenderLoop()
    startPreviewLoop()
  } catch (error) {
    showError('No camera. Allow camera access, or open this page in a real tab.')
  }
}

function stopCamera() {
  if (previewTimer) {
    clearInterval(previewTimer)
    previewTimer = null
  }
  if (booth) {
    booth.dispose()
    booth = null
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop())
    cameraStream = null
  }
  cameraReady = false
}

function startRenderLoop() {
  if (renderStarted) return
  renderStarted = true
  let last = 0
  const tick = (now) => {
    if (state.inSession && now - last > 33) {
      last = now
      if (cameraReady && booth) booth.frame()
      // Live partner viewfinder: copy their WebRTC video into the pane each tick.
      if (state.rtcMode === 'live' && remoteVideo.videoWidth) {
        const ctx = els.theirCam.getContext('2d')
        ctx.drawImage(remoteVideo, 0, 0, els.theirCam.width, els.theirCam.height)
        els.theirWait.hidden = true
      }
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function startPreviewLoop() {
  if (previewTimer) clearInterval(previewTimer)
  previewTimer = setInterval(async () => {
    if (!state.inSession || !cameraReady || !booth || !state.partner || !net || !net.connected) return
    // With live video flowing and the tab visible, frames are redundant. When video
    // cannot connect, or the tab is hidden (rAF/canvas freeze), frames carry the pane
    // at a video-like rate (the browser throttles this to ~1/s in the background).
    if (state.rtcMode === 'live' && !document.hidden) return
    if (state.previewBusy) return
    state.previewBusy = true
    try {
      const blob = await booth.previewBlob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      net.sendBinary(encodeFrame(KIND.PREVIEW, { id: state.myId }, bytes))
    } finally {
      state.previewBusy = false
    }
  }, 100)
}

// ---- controls ----------------------------------------------------------------

function buildFilterChips() {
  els.filterChips.textContent = ''
  for (const filter of FILTERS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'chip'
    button.textContent = filter.label
    button.addEventListener('click', () => {
      if (booth) booth.settings.filterMode = filter.id
      buildFilterChips()
    })
    if (booth && booth.settings.filterMode === filter.id) button.classList.add('is-active')
    els.filterChips.appendChild(button)
  }
}

function applyControlValues() {
  if (!booth) return
  booth.settings.grain = Number(els.grain.value)
  booth.settings.pixelSize = Number(els.pixel.value)
  booth.settings.stamp = els.stamp.checked
  booth.settings.mirror = els.mirror.checked
  els.grainOut.textContent = els.grain.value
  els.pixelOut.textContent = els.pixel.value
}

for (const el of [els.grain, els.pixel, els.stamp, els.mirror]) {
  el.addEventListener('input', applyControlValues)
  el.addEventListener('change', applyControlValues)
}

// ---- network -----------------------------------------------------------------

const relayUrl = () => {
  const override = new URLSearchParams(location.search).get('relay')
  if (override) return override
  const scheme = location.protocol === 'https:' ? 'wss://' : 'ws://'
  return `${scheme}${location.host}/ws`
}

function ensureNet() {
  if (net) return
  net = createNet({
    url: relayUrl(),
    handlers: {
      onStatus(status) {
        if (status === 'open') {
          if (state.room) net.send({ type: 'join', room: state.room })
          updatePartnerUI()
        } else {
          setStatus('', 'reconnecting…')
          state.partner = false
          updatePartnerUI()
        }
      },

      onControl(msg) {
        switch (msg.type) {
          case 'welcome':
            state.myId = msg.id
            maybeStartRtc()
            break
          case 'joined':
            state.myId = msg.id || state.myId
            state.partner = (msg.peers || 1) >= 2
            updatePartnerUI()
            if (state.partner) {
              sendRtcHello()
              maybeStartRtc()
            }
            break
          case 'join-error':
            showError(msg.reason === 'full' ? 'Room is full (2 people max). Start a new session.' : 'Could not join that room.')
            // A dead room is a dead end; go back to the landing instead of hanging.
            location.hash = ''
            break
          case 'peer-joined':
            state.partner = true
            updatePartnerUI()
            sendRtcHello()
            maybeStartRtc()
            break
          case 'peer-left':
            state.partner = false
            teardownRtc()
            updatePartnerUI()
            break
          case 'countdown':
            // broadcast:false is load-bearing -- a received countdown must never be
            // re-broadcast, or the two clients ping-pong it forever.
            runCountdown(msg.ms || 3000, { broadcast: false })
            break
          case 'clear':
            clearPhotos(false)
            break
          case 'rtc-hello':
            state.partnerId = msg.from || state.partnerId
            maybeStartRtc()
            break
          case 'rtc-offer':
          case 'rtc-answer':
          case 'rtc-ice':
            ensureRtc().handleSignal(msg)
            break
        }
      },

      onFrame(frame) {
        if (frame.kind === KIND.PREVIEW) {
          drawTheirPreview(frame.payload)
        } else if (frame.kind === KIND.SHUTTER) {
          addPhoto('them', new Blob([frame.payload], { type: 'image/jpeg' }))
        }
      },
    },
  })
}

// ---- live video (WebRTC) -------------------------------------------------------

function ensureRtc() {
  if (rtc) return rtc
  rtc = createRtc({
    iceServers: ICE_SERVERS,
    send: (obj) => {
      if (net) net.send(obj)
    },
    onRemoteStream: (stream) => {
      remoteVideo.srcObject = stream
      remoteVideo.play().catch(() => undefined)
    },
    onState: (connectionState) => {
      if (connectionState === 'connected') {
        state.rtcMode = 'live'
      } else if (connectionState === 'failed' || connectionState === 'closed') {
        // Fall back to preview frames rather than showing a frozen pane.
        state.rtcMode = 'frames'
      }
      updatePartnerUI()
    },
  })
  return rtc
}

function sendRtcHello() {
  if (net) net.send({ type: 'rtc-hello' })
}

function maybeStartRtc() {
  if (!state.inSession || !state.partner || !state.myId || !state.partnerId) return
  if (state.rtcMode === 'connecting' || state.rtcMode === 'live') return

  state.rtcMode = 'connecting'
  const conn = ensureRtc()
  Promise.resolve()
    .then(() => conn.addLocal((booth && booth.stream) || els.myCam.captureStream(30)))
    .then(() => {
      // Deterministic: exactly one side offers (see rtc.js).
      if (shouldOffer(state.myId, state.partnerId)) return conn.makeOffer()
    })
    .catch(() => {
      state.rtcMode = 'frames'
      updatePartnerUI()
    })
}

async function drawTheirPreview(payload) {
  let bitmap
  try {
    bitmap = await createImageBitmap(new Blob([payload], { type: 'image/jpeg' }))
  } catch {
    return
  }
  const ctx = els.theirCam.getContext('2d')
  ctx.drawImage(bitmap, 0, 0, els.theirCam.width, els.theirCam.height)
  bitmap.close()
  els.theirWait.hidden = true
}

// ---- shutter -----------------------------------------------------------------

async function captureAndSend() {
  if (!cameraReady || !booth || !net) return
  try {
    const blob = await booth.snapshotBlob()
    addPhoto('me', blob)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    net.sendBinary(
      encodeFrame(KIND.SHUTTER, { id: state.myId, filter: booth.settings.filterMode, ts: Date.now() }, bytes)
    )
  } catch (error) {
    showError('Could not take the photo.')
  }
}

function runCountdown(ms, { broadcast = true } = {}) {
  if (state.counting) return
  state.counting = true
  if (broadcast && net) net.send({ type: 'countdown', ms })

  els.countdown.hidden = false
  const t0 = performance.now()
  const tick = () => {
    const left = ms - (performance.now() - t0)
    if (left <= 0) {
      els.countdown.hidden = true
      state.counting = false
      captureAndSend()
      return
    }
    els.countNum.textContent = String(Math.max(1, Math.ceil(left / 1000)))
    requestAnimationFrame(tick)
  }
  tick()
}

els.togetherBtn.addEventListener('click', () => runCountdown(3000))
els.soloBtn.addEventListener('click', () => captureAndSend())

// ---- photo strip ---------------------------------------------------------------

function addPhoto(who, blob) {
  const photo = { who, blob, url: URL.createObjectURL(blob), ts: Date.now(), selected: true }
  state.photos.push(photo)

  const div = document.createElement('div')
  div.className = `thumb ${who}`
  const img = document.createElement('img')
  img.src = photo.url
  img.alt = who === 'me' ? 'my photo' : 'their photo'
  const tag = document.createElement('span')
  tag.className = 'who'
  tag.textContent = who === 'me' ? 'ME' : 'YOU'
  div.append(img, tag)
  // Tap a thumb to include or drop it from the collage.
  div.addEventListener('click', () => {
    photo.selected = !photo.selected
    div.classList.toggle('off', !photo.selected)
    updateCollageBtn()
  })
  els.strip.appendChild(div)
  // scrollLeft, not scrollIntoView -- the latter drags the whole page on mobile.
  els.strip.scrollLeft = els.strip.scrollWidth
  els.stripCount.textContent = String(state.photos.length)
  updateCollageBtn()
}

function updateCollageBtn() {
  const n = state.photos.filter((photo) => photo.selected).length
  els.collageBtn.textContent = `MAKE COLLAGE (${n})`
}

function clearPhotos(announce) {
  for (const photo of state.photos) URL.revokeObjectURL(photo.url)
  state.photos = []
  els.strip.textContent = ''
  els.stripCount.textContent = '0'
  updateCollageBtn()
  if (announce && net) net.send({ type: 'clear' })
}

els.clearBtn.addEventListener('click', () => clearPhotos(true))

// ---- collage --------------------------------------------------------------------

els.collageBtn.addEventListener('click', async () => {
  const chosen = state.photos.filter((photo) => photo.selected)
  if (chosen.length === 0) {
    showError('No photos selected.')
    return
  }
  await renderCollage(els.collageCanvas, chosen)
  els.collageModal.hidden = false
})

els.downloadBtn.addEventListener('click', () => {
  const stamp = new Date().toISOString().slice(0, 10)
  downloadCanvas(els.collageCanvas, `vynt-together-${stamp}.png`)
})

els.closeCollage.addEventListener('click', () => {
  els.collageModal.hidden = true
})

// ---- session chrome ----------------------------------------------------------------

els.startBtn.addEventListener('click', () => {
  location.hash = `#/r/${makeRoomCode()}`
})

els.copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(location.href)
    els.copyBtn.textContent = 'COPIED ✓'
    setTimeout(() => (els.copyBtn.textContent = 'COPY LINK'), 1500)
  } catch {
    window.prompt('Copy your session link:', location.href)
  }
})

els.errorClose.addEventListener('click', () => {
  els.errorCard.hidden = true
})

window.addEventListener('hashchange', route)
window.addEventListener('beforeunload', () => {
  if (net && state.room) net.send({ type: 'leave' })
})

route()
