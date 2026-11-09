// VYNT Together -- session orchestration.
//
// One page, hash-routed rooms (#/r/CODE). Each side streams tiny filtered preview
// frames so both see the same viewfinders, and full-res filtered stills on the shutter.
// A "click together" countdown fires both shutters within one beat of each other.

import { KIND, makeRoomCode, encodeFrame } from './codec.js'
import { createNet } from './net.js'
import { createBooth, FILTERS } from './capture.js'
import { renderCollage, downloadCanvas } from './collage.js'

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
  partner: false,
  inSession: false,
  photos: [], // { who:'me'|'them', blob, url, ts }
  previewBusy: false,
  counting: false,
}

let booth = null
let net = null
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
  els.partnerPill.textContent = state.partner ? 'partner here · LIVE' : 'waiting for partner…'
  els.partnerPill.classList.toggle('on', state.partner)
  if (state.partner) setStatus('live', 'LIVE — 2 in room')
  else if (net && net.connected) setStatus('open', state.room ? 'connected — waiting for partner' : 'relay up')
  if (!state.partner) els.theirWait.hidden = false
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
  // Leaving a session must actually leave: tell the room, and turn the camera off.
  if (net && state.room) net.send({ type: 'leave' })
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
    booth = createBooth({ video })
    applyControlValues()
    cameraReady = true
    startRenderLoop()
    startPreviewLoop()
  } catch (error) {
    showError(
      'Camera unavailable. Allow camera access for this page — if you are inside an embedded preview, open the link in a new tab.'
    )
  }
}

function stopCamera() {
  if (previewTimer) {
    clearInterval(previewTimer)
    previewTimer = null
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop())
    cameraStream = null
  }
  cameraReady = false
  booth = null
}

function startRenderLoop() {
  if (renderStarted) return
  renderStarted = true
  let last = 0
  const tick = (now) => {
    if (state.inSession && cameraReady && booth && now - last > 33) {
      last = now
      booth.renderTo(els.myCam, 480, 270)
    }
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function startPreviewLoop() {
  if (previewTimer) clearInterval(previewTimer)
  previewTimer = setInterval(async () => {
    if (!state.inSession || !cameraReady || !booth || !state.partner || !net || !net.connected) return
    if (document.hidden || state.previewBusy) return
    state.previewBusy = true
    try {
      const blob = await booth.previewBlob()
      const bytes = new Uint8Array(await blob.arrayBuffer())
      net.sendBinary(encodeFrame(KIND.PREVIEW, { id: state.myId }, bytes))
    } finally {
      state.previewBusy = false
    }
  }, 350)
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
            break
          case 'joined':
            state.myId = msg.id || state.myId
            state.partner = (msg.peers || 1) >= 2
            updatePartnerUI()
            break
          case 'join-error':
            if (msg.reason === 'full') {
              showError('That room is full — VYNT Together rooms hold exactly two people. Start your own session!')
            } else {
              showError('Could not join that room.')
            }
            // A dead room is a dead end; go back to the landing instead of hanging.
            location.hash = ''
            break
          case 'peer-joined':
            state.partner = true
            updatePartnerUI()
            break
          case 'peer-left':
            state.partner = false
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
    showError('Could not take the photo — is the camera still available?')
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
  const url = URL.createObjectURL(blob)
  state.photos.push({ who, blob, url, ts: Date.now() })

  const div = document.createElement('div')
  div.className = `thumb ${who}`
  const img = document.createElement('img')
  img.src = url
  img.alt = who === 'me' ? 'my photo' : 'their photo'
  const tag = document.createElement('span')
  tag.className = 'who'
  tag.textContent = who === 'me' ? 'ME' : 'YOU'
  div.append(img, tag)
  els.strip.appendChild(div)
  // scrollLeft, not scrollIntoView -- the latter drags the whole page on mobile.
  els.strip.scrollLeft = els.strip.scrollWidth
  els.stripCount.textContent = String(state.photos.length)
}

function clearPhotos(announce) {
  for (const photo of state.photos) URL.revokeObjectURL(photo.url)
  state.photos = []
  els.strip.textContent = ''
  els.stripCount.textContent = '0'
  if (announce && net) net.send({ type: 'clear' })
}

els.clearBtn.addEventListener('click', () => clearPhotos(true))

// ---- collage --------------------------------------------------------------------

els.collageBtn.addEventListener('click', async () => {
  if (state.photos.length === 0) {
    showError('No photos yet — click the shutter first.')
    return
  }
  await renderCollage(els.collageCanvas, state.photos)
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
