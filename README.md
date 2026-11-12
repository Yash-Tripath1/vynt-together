# VYNT TOGETHER

**One link, two cameras, one booth.** Send a session link to your person, see each other
live while you pose, press **CLICK TOGETHER** so the shutter fires on both ends at once,
then make a collage from everything you shot.

No account. No app. Nothing stored anywhere.

> **Status: v0.4.0.** Meet-grade live video, worker-side filtering, synced shutter, shared
> strip, collage export with photo picking. 26 unit tests and a 14-check end-to-end smoke run.

## Changelog

**v0.4.0, the live one:**
- The viewfinder is now a real WebRTC video track, the way Meet does it: frames are grabbed
  already scaled to 480x270 (one cheap GPU resize), rendered in the worker, and pushed into
  the track the moment they land (manual captureStream + requestFrame). The encoder is
  tuned motion-first at a steady 30 fps, capped at 900 kbps, so it moves like a video call.
- TURN fallback (free OpenRelay, UDP and TCP-443) added alongside STUN, so the video call
  connects through symmetric NATs and networks where UDP never flows. Swap in your own TURN
  credentials for production.
- When video still cannot connect, the frame fallback streams at 10 fps instead of one
  frame every 350 ms, so even the slow path feels live.
- Tap any photo in the strip to include or drop it from the collage. The button always
  shows how many are picked.
- Collage shapes adapt to the pick: 2 photos make a portrait pair, 3 make a tall hero
  beside two stacked cards, 4 make a 2x2 quad.

**v0.3.1, refinement:**
- All pixel work moved into a Web Worker (OffscreenCanvas), so filtering no longer blocks
  the UI or the video encoder. The main thread only grabs frames and blits results.
- Preview frames are derived from the rendered pane instead of re-filtering, and shutter
  captures run through the worker at full size.
- Camera startup waits for real frames; a lost camera is reported instead of silently
  going black; the worker falls back to main-thread rendering if it crashes.
- Landing page and status text trimmed; the decorative scanline overlay removed (it cost
  compositing time under every video frame).

**v0.3.0, live viewfinders:**
- Both panes stream filtered video peer-to-peer over WebRTC (DTLS-SRTP by default).
- Signalling (SDP/ICE) rides the relay as ordinary control messages; the server needed
  zero changes. Glare-free negotiation: the peer with the smaller server id offers.
- Graceful fallback: if P2P cannot connect or a tab goes hidden, relayed JPEG frames keep
  the pane alive. The pill shows VIDEO or FRAMES so you know which path is active.

**v0.2.0, self-audit:** fixed a countdown broadcast loop, overlays hidden by a CSS
override (the stuck page), ghost rooms on rejoin, camera teardown, and five smaller bugs.

**v0.1.0:** first working draft.

## How it works

```
   you                                                      your person
   camera -> VYNT filter (worker) -> live video ==P2P==> their viewfinder
     |              canvas capture              (WebRTC, encrypted)
     |                                    signalling only (SDP/ICE)
     +-> shutter still (full-res) --> tiny relay <-- their shutter stills
                                      stores nothing
                                      rooms evaporate when empty
     both sides: shared photo strip -> collage -> PNG

   fallback when P2P cannot connect or a tab is hidden: relayed JPEG frames
```

The eight VYNT filters (original, vyntage, digicam, nightflash, neoncity, fisheye, vhs,
goldenfilm) plus grain, pixelation and a date stamp are the same maths as
[VYNT](https://github.com/Yash-Tripath1/Vynt) and
[vynt-meet](https://github.com/Yash-Tripath1/vynt-meet): a verbatim, pixel-identical port
(`tests/filters.test.js` proves it against the upstream implementation).

## Quick start

Node 18 or newer. One dependency (`ws`).

```bash
npm install
npm start            # relay + web app on http://localhost:8765
```

1. Open http://localhost:8765 and press **START A SESSION**.
2. Open the room link in a second tab (or a second browser) to play both sides.
3. Allow the camera on both, then press **CLICK TOGETHER**.

**Testing with a real person.** Two tabs on one machine works out of the box. Browsers
only allow cameras on secure origins, so a phone on plain `http://192.168.x.x:8765` will
load the page but the camera will be refused. Use a tunnel (`ngrok http 8765`,
`cloudflared tunnel --url http://localhost:8765`) or deploy (below), both give HTTPS.

```bash
npm test                                       # 26 unit tests
node scripts/smoke.mjs http://localhost:8765   # 14-check end-to-end relay smoke
```

## Deploying

The relay and the app are one process, so deployment is one service:

- **Render / Railway / Fly.io (free tier works):** new web service, `npm start`, set
  `PORT` from the platform. Give people the URL.
- **Split deployment:** host `web/` on GitHub Pages and run the relay elsewhere. The app
  picks its relay from `?relay=wss://your-relay/ws`.

## Privacy model

- Frames are **relayed, never stored**. The server does not parse image data.
- A room holds exactly two people and **exists only while someone is in it**.
- Room codes are random, 6 characters, no confusables. A dead room is a dead code.
- Live video is peer-to-peer and encrypted; the relay only brokers the introduction.
- The only "account" is the link. Do not post session links publicly.

## Known limits

- No audio (it is a booth, not a call).
- A hidden tab degrades to about 1 fps of relayed frames instead of true video.
- Pairs behind symmetric NATs on both ends may fall back to frames mode. Add a TURN
  server to `ICE_SERVERS` in `web/js/app.js` for full reliability.

## Project layout

```
server/index.js       static host + WebSocket relay (relay-only, no persistence)
server/rooms.js       pure room bookkeeping: capacity, eviction, routing
web/index.html        landing + session UI
web/js/render.js      the booth render (crop, pixelate, filter, stamp)
web/js/filter.worker.js  OffscreenCanvas filter worker
web/js/capture.js     camera, worker orchestration, preview and shutter JPEGs
web/js/rtc.js         WebRTC viewfinders + glare-free negotiation
web/js/filters.js     the verbatim VYNT filter port (see LICENSE)
web/js/codec.js       wire format: JSON control + binary JPEG frames
web/js/net.js         WebSocket wrapper with auto-reconnect
web/js/collage.js     pure layout + canvas render + PNG export
tests/                26 unit tests
scripts/smoke.mjs     end-to-end relay smoke
```

## Roadmap

- ✅ shared viewfinders, synced shutter, strip, collage
- ✅ live two-way video (WebRTC P2P, relay signalling, frames fallback)
- ✅ worker-side filtering and the v0.2/v0.3 audits
- ☐ TURN option and audio mode
- ☐ rooms for more than two, captions, strip-as-GIF
- ☐ a card on [yash-tripath1.github.io/Vynt](https://yash-tripath1.github.io/Vynt/) pointing here

## Credits

Built on the VYNT family:
[VYNT](https://github.com/Yash-Tripath1/Vynt) (filter maths copyright 2026 Anadi Tripathi)
and [VYNT for Google Meet](https://github.com/Yash-Tripath1/vynt-meet). MIT, see `LICENSE`.
