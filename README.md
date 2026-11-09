# VYNT TOGETHER

**One link, two cameras, one booth.** Send a session link to your person, see each other
**live** while you pose, press **CLICK TOGETHER** and the shutter fires on both ends at
once — then make a collage from everything you shot.

No account. No app. Nothing stored anywhere.

> **Status: v0.3.0 — live viewfinders.** The two panes are real, two-way WebRTC video
> (filtered, P2P, DTLS-SRTP encrypted); the relay handles signalling, stills and the
> strip. Unit tests + a 14-check end-to-end smoke run. Grab a friend and be the first
> real-world test — see "Quick start".

## What changed in v0.3.0 — live viewfinders (phase 2)

The partner pane used to refresh ~3×/second via relayed JPEG frames — alive, but a
slideshow. Now both viewfinders are **live WebRTC video**:

- Each side streams its *filtered* canvas (`captureStream`) peer-to-peer — what they see
  moving is exactly what the shutter will capture.
- **Signalling rides the existing relay** (SDP + ICE are ordinary control messages), so
  the server needed zero changes. Negotiation is glare-free: the peer with the smaller
  server-assigned id makes the offer.
- **Graceful fallback, always:** if the P2P path can't connect (strict double-NAT pairs
  without a TURN server) or your tab goes hidden (canvas pipelines freeze off-screen),
  the old JPEG-frame path carries the pane automatically — the pill shows `VIDEO` or
  `FRAMES` so you know which one you're on.
- Known limits, honestly: no audio (it's a booth), and a hidden tab degrades to ~1 fps
  frames instead of true video. Both are on the roadmap below.

## What changed in the second draft

A full self-audit found and fixed nine issues in the first draft:

1. **Countdown ping-pong (critical).** A received "click together" countdown was
   re-broadcast to the room, so two connected clients bounced it between each other
   forever. Received countdowns now run locally only.
2. **Invisible overlays (critical — the "stuck page").** The countdown, collage modal and
   error card set `display:flex`, which overrides the browser's `[hidden]` rule, so the
   countdown overlay sat over the page from the moment it loaded. Fixed globally.
3. **Ghost rooms.** Switching rooms without closing the tab left the abandoned room's
   other person waiting forever. Re-joins now notify the room you left (and re-joining
   your own room is a harmless no-op).
4. **The camera never turned off.** Leaving a session now stops the camera tracks (LED
   goes off) and tears down the preview loop.
5. **Crash when the camera is denied.** Clicking a filter chip with no camera threw.
6. **`scrollIntoView` dragged the whole page** on mobile when a photo landed in the strip.
7. **Intentional disconnects reported "reconnecting…"** forever.
8. **Frame grabs could throw** on a not-yet-ready video element.
9. **README told you to use `http://<lan-ip>:8765` from a phone** — browsers refuse camera
   access on insecure origins, so that advice could never work. Corrected.

---

## How it works

```
   you                                                      your person
   ────                                                     ───────────
   camera ──► VYNT filter ──► live video track ═══P2P═══► their viewfinder
      │              (canvas)        (WebRTC, encrypted)      │
      │                                   ▲                   │
      │                     signalling: SDP/ICE only          │
      │                          ┌────────┴────────┐          ▼
      └──► shutter still ──────► │  tiny relay     │ ◄── their shutter stills
             (full-res, via) ──► │  (this server)  │ ──► shared photo strip
                                 │  stores nothing │
                                 └─────────────────┘
   fallback when P2P can't connect or the tab is hidden: relayed JPEG frames
```

* **Live viewfinders, not video chat.** Both panes stream filtered video peer-to-peer
  (WebRTC). The relay only brokers the introduction (SDP/ICE) — media never touches the
  server. If the P2P path fails or your tab goes hidden, low-fps relayed frames keep the
  pane alive instead of freezing.
* **Click together.** A shared 3-2-1 countdown fires both shutters within one beat. There
  is also a *JUST ME* button for vanity shots.
* **Collage.** Both sides hold every photo, so either side can lay out the strip and save
  a PNG (amber border = yours, blue = theirs).

The eight VYNT filters (`original · vyntage · digicam · nightflash · neoncity · fisheye ·
vhs · goldenfilm`) plus grain, pixelation and a date stamp are the same maths as
[VYNT](https://github.com/Yash-Tripath1/Vynt) and
[vynt-meet](https://github.com/Yash-Tripath1/vynt-meet) — a verbatim, pixel-identical port
(`tests/filters.test.js` proves it against the upstream implementation).

## Quick start

Node ≥ 18. One dependency (`ws`).

```bash
npm install
npm start            # relay + web app on http://localhost:8765
```

1. Open http://localhost:8765 and hit **START A SESSION** — you get a room link.
2. Open the link in a **second tab** (or a second browser) to play both sides.
3. Allow the camera on both, watch the partner viewfinder appear, then **CLICK TOGETHER**.

**Testing with a real person.** Two tabs on one machine works out of the box. For a phone
or a friend on your LAN, note that browsers only allow cameras on **secure origins** —
plain `http://192.168.x.x:8765` will load the page but the camera will be refused. Use a
tunnel in front of the server (`ngrok http 8765`, `cloudflared tunnel --url
http://localhost:8765`) or deploy (below); both give you HTTPS. Across the internet:
deploy.

```bash
npm test                                  # 22 unit tests
node scripts/smoke.mjs http://localhost:8765   # 14-check end-to-end relay smoke
```

## Deploying

The relay and the app are one process, so deployment is one service:

* **Render / Railway / Fly.io (free tier works):** new web service → `npm start` → set
  `PORT` from the platform. That's the whole deploy; give people the URL.
* **Split deployment (optional):** host `web/` on GitHub Pages and run the relay
  somewhere else — the app picks its relay from `?relay=wss://your-relay/ws`.

## Privacy model (the short version)

* Frames are **relayed, never stored**. The server does not parse image data and keeps no
  logs of it.
* A room **exists only while someone is in it** and holds exactly two people. When the
  last person leaves, it is gone.
* Room codes are random, 6 characters, no confusables. Links expire by design: a dead
  room is just a dead code.
* The only "account" is the link. Don't post session links publicly and you're fine.

## Project layout

```
server/index.js      static host + WebSocket relay (relay-only, no persistence)
server/rooms.js      pure room bookkeeping -- capacity, eviction, routing
web/index.html       landing + session UI
web/js/capture.js    camera -> crop -> pixelation -> filter -> stamp
web/js/filters.js    the verbatim VYNT filter port (see LICENSE)
web/js/codec.js      wire format: JSON control + [kind|meta|jpeg] binary frames
web/js/net.js        WebSocket wrapper with auto-reconnect
web/js/collage.js    pure layout + canvas render + PNG export
tests/               19 unit tests (filter parity, rooms, codec, collage)
scripts/smoke.mjs    end-to-end relay smoke
```

## Roadmap

* ✅ shared viewfinders via preview frames, synced shutter, strip, collage
* ✅ second-draft audit: countdown, overlays, ghost rooms, camera teardown, docs
* ✅ live two-way video viewfinders (WebRTC P2P, relay signalling, frames fallback)
* ☐ TURN option + audio mode for the full "in the room" feeling
* ☐ rooms for more than two
* ☐ countdown speed presets, collages with captions, strip-as-GIF
* ☐ a card on [yash-tripath1.github.io/Vynt](https://yash-tripath1.github.io/Vynt/) pointing here

## Credits

Built on the VYNT family:
[VYNT](https://github.com/Yash-Tripath1/Vynt) (filter maths © 2026 Anadi Tripathi) ·
[VYNT for Google Meet](https://github.com/Yash-Tripath1/vynt-meet). MIT — see `LICENSE`.
