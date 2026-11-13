// VYNT Together -- session orchestration.
//
// One page, hash-routed rooms (#/r/CODE). Live viewfinders are real decoded video
// elements (Meet-style: native framerate, GPU composited, alive even in hidden tabs,
// because the raw camera track travels over WebRTC and the browser does the drawing).
// The VYNT look is GPU work layered on top (see looks.js). One click on CLICK TOGETHER
// fires both cameras under one shared photo id: both screens commit and show the pair
// at the same moment. Exact VYNT pixels are kept for the photos themselves.

import { KIND, makeRoomCode, encodeFrame } from './codec.js'
import { createNet } from './net.js'
import { createRtc, shouldOffer } from './rtc.js'
import { createFeed, FILTERS } from './capture.js'
import { applyLook } from './looks.js'
import { renderCollage, downloadCanvas } from './collage.js'
import { computeCoverCrop } from './layout.js'

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
  myPane: $('#myPane'),
  theirPane: $('#theirPane'),
  myVideo: $('#myVideo'),
  theirVideo: $('#theirVideo'),
  theirCam: $('#theirCam'),
  theirWait: $('#theirWait'),
  myStamp: $('#myStamp'),
  theirStamp: $('#theirStamp'),
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
  flash: $('#flash'),
  photoCard: $('#photoCard'),
  photoCardCanvas: $('#photoCardCanvas'),
  collageModal: $('#collageModal'),
  collageCanvas: $('#collageCanvas'),
  downloadBtn: $('#downloadBtn'),
  closeCollage: $('#closeCollage'),
  errorCard: $('#errorCard'),
  errorMsg: $('#errorMsg'),
  errorClose: $('#errorClose'),
  startBtn: $('#startBtn'),
}

// One booth, one look: both panes render with this shared settings object, and both
// screens keep it in sync over the relay.
const settings = {
  filterMode: 'vyntage',
  grain: 34,
  pixelSize: 3,
  stamp: true,
  mirror: true,
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
  rtcRetries: 0,
  remoteShown: false, // first remote video frame has landed in the pane
  lastSnapAt: 0, // suppresses the duplicate when both sides press at once
}

let myFeed = null
let net = null
let rtc = null
let cameraStream = null
let cameraReady = false
let watchStarted = false
let previewTimer = null
let cardTimer = null
const pairs = new Map() // snapId -> { me, them, timer, done }

// ---- helpers ----------------------------------------------------------------

function showError(message) {
  els.errorMsg.textContent = message
  els.errorCard.hidden = false
}

function setStatus(kind, text) {
  els.statusLed.className = `led ${kind}`
  els.statusText.textContent = text
}

function refreshLook() {
  applyLook([els.myPane, els.theirPane], settings)
}

function updatePartnerUI() {
  // VIDEO only when remote video frames actually land in the pane. A connection with no
  // flowing video (their camera is off) should read FRAMES, not lie.
  const videoLive = state.rtcMode === 'live' && els.theirVideo.videoWidth > 0
  const link = videoLive ? 'VIDEO' : state.rtcMode === 'frames' ? 'FRAMES' : 'CONNECTED'
  els.partnerPill.textContent = state.partner ? link : 'WAITING'
  els.partnerPill.classList.toggle('on', state.partner)
  if (state.partner) setStatus('live', 'LIVE 2/2')
  else if (net && net.connected) setStatus('open', state.room ? 'connected' : 'relay up')
  if (!state.partner) els.theirWait.hidden = false
  if (videoLive) {
    els.theirVideo.hidden = false
    els.theirCam.hidden = true
    els.theirWait.hidden = true
  }
}

function teardownRtc() {
  if (rtc) {
    rtc.close()
    rtc = null
  }
  els.theirVideo.srcObject = null
  state.rtcMode = 'idle'
  state.partnerId = null
  state.rtcRetries = 0
  state.remoteShown = false
}

/** A dead connection must be dropped, not reused: the next attempt builds a fresh one
 *  instead of offering into a corpse. Two automatic retries, then frames mode stays. */
function failRtc() {
  state.rtcMode = 'frames'
  if (rtc) {
    rtc.close()
    rtc = null
  }
  updatePartnerUI()
  if (state.inSession && state.partner && state.rtcRetries < 2) {
    state.rtcRetries += 1
    setTimeout(() => maybeStartRtc(), 2000)
  }
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
    startWatchLoop()
    const cameraDone = startCamera()
    ensureNet() // connect to the relay while the camera warms up
    buildFilterChips()
    refreshLook()
    await cameraDone
    buildFilterChips()
  }
  if (net && net.connected) net.send({ type: 'join', room })
  updatePartnerUI()
}

// ---- camera ------------------------------------------------------------------

async function startCamera() {
  if (cameraReady) return
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    els.myVideo.srcObject = cameraStream
    await els.myVideo.play()

    // Wait for real frames before declaring the camera up.
    for (let i = 0; i < 100 && !els.myVideo.videoWidth; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    if (!els.myVideo.videoWidth) throw new Error('camera produced no frames')

    const [track] = cameraStream.getVideoTracks()
    if (track) {
      track.addEventListener('ended', () => {
        if (!state.inSession) return
        stopCamera()
        showError('Camera stopped. Reload the page to reconnect it.')
      })
    }

    myFeed = createFeed({ video: els.myVideo, settings })
    cameraReady = true
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
  if (myFeed) {
    myFeed.dispose()
    myFeed = null
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop())
    cameraStream = null
  }
  cameraReady = false
}

/** Cheap watcher: the video elements draw themselves, this only notices when the
 *  partner's first frame lands (pane swap + pill) and keeps nothing else warm. */
function startWatchLoop() {
  if (watchStarted) return
  watchStarted = true
  const tick = () => {
    if (state.inSession && els.theirVideo.videoWidth > 0 && !state.remoteShown) {
      state.remoteShown = true
      updatePartnerUI()
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function startPreviewLoop() {
  if (previewTimer) clearInterval(previewTimer)
  previewTimer = setInterval(async () => {
    if (!state.inSession || !cameraReady || !myFeed || !state.partner || !net || !net.connected) return
    // The raw video track is the live path and survives hidden tabs by itself. These
    // frames only exist for when video cannot connect at all (the browser throttles
    // this to ~1/s in the background, which still beats a frozen pane).
    if (state.rtcMode === 'live') return
    if (state.previewBusy) return
    state.previewBusy = true
    try {
      const blob = await myFeed.previewBlob()
      if (blob) {
        const bytes = new Uint8Array(await blob.arrayBuffer())
        net.sendBinary(encodeFrame(KIND.PREVIEW, { id: state.myId }, bytes))
      }
    } finally {
      state.previewBusy = false
    }
  }, 100)
}

// ---- controls (shared booth settings) ----------------------------------------

function buildFilterChips() {
  els.filterChips.textContent = ''
  for (const filter of FILTERS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'chip'
    button.textContent = filter.label
    button.addEventListener('click', () => {
      settings.filterMode = filter.id
      buildFilterChips()
      refreshLook()
      broadcastSettings()
    })
    if (settings.filterMode === filter.id) button.classList.add('is-active')
    els.filterChips.appendChild(button)
  }
}

function applyControlValues(broadcast = true) {
  settings.grain = Number(els.grain.value)
  settings.pixelSize = Number(els.pixel.value)
  settings.stamp = els.stamp.checked
  settings.mirror = els.mirror.checked
  els.grainOut.textContent = els.grain.value
  els.pixelOut.textContent = els.pixel.value
  refreshLook()
  if (broadcast) broadcastSettings()
}

function syncControls() {
  els.grain.value = settings.grain
  els.pixel.value = settings.pixelSize
  els.stamp.checked = settings.stamp
  els.mirror.checked = settings.mirror
  els.grainOut.textContent = settings.grain
  els.pixelOut.textContent = settings.pixelSize
  buildFilterChips()
  refreshLook()
}

function broadcastSettings() {
  if (net && state.partner) net.send({ type: 'settings', settings: { ...settings } })
}

for (const el of [els.grain, els.pixel, els.stamp, els.mirror]) {
  el.addEventListener('input', () => applyControlValues())
  el.addEventListener('change', () => applyControlValues())
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
              broadcastSettings()
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
            broadcastSettings()
            maybeStartRtc()
            break
          case 'peer-left':
            state.partner = false
            teardownRtc()
            updatePartnerUI()
            break
          case 'snap':
            // A received snap must never be re-broadcast, or the two clients ping-pong
            // it forever. It fires this side's shutter under the SAME photo id, so one
            // click makes one shared photo. Both sides pressing at once (within 700 ms)
            // is the same moment and makes one photo, not two.
            if (Date.now() - state.lastSnapAt < 700) break
            captureAndSend(msg.snapId || `snap-${Date.now()}`, false)
            break
          case 'settings':
            if (msg.settings) {
              Object.assign(settings, msg.settings)
              syncControls()
            }
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
          const meta = frame.meta || {}
          addShutterPhoto('them', new Blob([frame.payload], { type: 'image/jpeg' }), meta.snapId, meta.solo)
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
      els.theirVideo.srcObject = stream
      els.theirVideo.play().catch(() => undefined)
    },
    onState: (connectionState) => {
      if (connectionState === 'connected') {
        state.rtcMode = 'live'
        state.rtcRetries = 0
      } else if (connectionState === 'failed' || connectionState === 'closed') {
        // Fall back to preview frames rather than showing a frozen pane, and schedule
        // a fresh connection attempt (see failRtc).
        failRtc()
        return
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
    .then(() => {
      // The raw camera track: the media pipeline keeps it alive even when this tab is
      // hidden, which is what makes the partner's pane genuinely live.
      if (cameraStream) return conn.addLocal(cameraStream)
    })
    .then(() => {
      // Deterministic: exactly one side offers (see rtc.js).
      if (shouldOffer(state.myId, state.partnerId)) return conn.makeOffer()
    })
    .catch(() => failRtc())
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
  els.theirCam.hidden = false
  els.theirVideo.hidden = true
  els.theirWait.hidden = true
}

// ---- shutter + shared photo events ---------------------------------------------

function flash() {
  els.flash.classList.remove('go')
  void els.flash.offsetWidth // restart the animation
  els.flash.classList.add('go')
}

async function captureAndSend(snapId, solo) {
  if (!cameraReady || !myFeed || !net) return
  state.lastSnapAt = Date.now()
  flash()
  try {
    const blob = await myFeed.snapshotBlob()
    addShutterPhoto('me', blob, snapId, solo)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    net.sendBinary(
      encodeFrame(KIND.SHUTTER, { id: state.myId, snapId, solo: Boolean(solo), ts: Date.now() }, bytes)
    )
  } catch (error) {
    showError('Could not take the photo.')
  }
}

/** Photos land here with a shared event id. Both halves commit together, so both
 *  screens show the same pair at the same moment. A solo photo is its own event. */
function addShutterPhoto(who, blob, snapId, solo) {
  if (!snapId || solo) {
    addPhoto(who, blob)
    showPhotoCard(who === 'me' ? blob : null, who === 'them' ? blob : null)
    return
  }
  let entry = pairs.get(snapId)
  if (!entry) {
    entry = { me: null, them: null, done: false, timer: 0 }
    entry.timer = setTimeout(() => commitPair(snapId), 2500)
    pairs.set(snapId, entry)
  }
  entry[who] = entry[who] || blob
  if (entry.me && entry.them) commitPair(snapId)
}

function commitPair(snapId) {
  const entry = pairs.get(snapId)
  if (!entry || entry.done) return
  entry.done = true
  clearTimeout(entry.timer)
  pairs.delete(snapId)
  if (entry.me) addPhoto('me', entry.me)
  if (entry.them) addPhoto('them', entry.them)
  showPhotoCard(entry.me, entry.them)
}

function showPhotoCard(meBlob, themBlob) {
  clearTimeout(cardTimer)
  drawPhotoCard(meBlob, themBlob)
  els.photoCard.hidden = false
  cardTimer = setTimeout(() => {
    els.photoCard.hidden = true
  }, 3200)
}

async function drawPhotoCard(meBlob, themBlob) {
  const canvas = els.photoCardCanvas
  const tiles = meBlob && themBlob ? 2 : 1
  canvas.width = tiles === 2 ? 720 : 360
  canvas.height = 480
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#12100c'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const halves = tiles === 2 ? [meBlob, themBlob] : [meBlob || themBlob]
  for (let i = 0; i < halves.length; i += 1) {
    if (!halves[i]) continue
    let bitmap
    try {
      bitmap = await createImageBitmap(halves[i])
    } catch {
      continue
    }
    const x = i * (canvas.width / halves.length)
    const w = canvas.width / halves.length
    const rect = computeCoverCrop(bitmap.width, bitmap.height, w, canvas.height, 1)
    ctx.drawImage(bitmap, rect.sx, rect.sy, rect.sw, rect.sh, x, 0, w, canvas.height)
    bitmap.close()
  }
}

els.photoCard.addEventListener('click', () => {
  els.photoCard.hidden = true
  clearTimeout(cardTimer)
})

els.togetherBtn.addEventListener('click', () => {
  if (!cameraReady || !myFeed || !net) {
    showError('No camera.')
    return
  }
  const snapId = `${state.myId || 'me'}-${Date.now()}`
  net.send({ type: 'snap', snapId })
  captureAndSend(snapId, false)
})
els.soloBtn.addEventListener('click', () => {
  if (!cameraReady || !myFeed || !net) {
    showError('No camera.')
    return
  }
  captureAndSend(`solo-${Date.now()}`, true)
})

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
  for (const [, entry] of pairs) clearTimeout(entry.timer)
  pairs.clear()
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

const today = new Date().toISOString().slice(0, 10)
els.myStamp.textContent = today
els.theirStamp.textContent = today

window.addEventListener('hashchange', route)
window.addEventListener('beforeunload', () => {
  if (net && state.room) net.send({ type: 'leave' })
})

route()
