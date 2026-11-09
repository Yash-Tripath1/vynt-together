# VYNT TOGETHER

**One link, two cameras, one booth.** Send a session link to your person, see each other's
viewfinder while you pose, press **CLICK TOGETHER** and the shutter fires on both ends at
once — then make a collage from everything you shot.

No account. No app. Nothing stored anywhere.

> **Status: second draft (v0.2.0).** The filter maths, room relay and protocol are
> unit-tested (19 tests) and the relay passes a 13-check end-to-end smoke run, including
> regression tests for every bug the first draft shipped with. Grab a friend and be the
> first real-world test — see "Quick start".

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
   you                                                     your person
   ────                                                    ───────────
   camera ──► VYNT filter ──► tiny preview frames (≈3/s) ──► their screen
      │                              ▲        │
      │                              │        ▼
      └──► shutter still (full-res) ──┼──► shared photo strip
                                     │
                            ┌────────┴────────┐
                            │  tiny relay     │   forwards only, stores nothing,
                            │  (this server)  │   rooms evaporate when empty
                            └────────┬────────┘
                                     │
   their screen ◄── preview frames ──┘
   their shutter stills land in the same strip on your side
```

* **Preview frames, not video.** Each side streams ~3 small JPEGs per second so you can
  see what the other is framing. That's deliberately enough for posing together — and it
  keeps the whole thing light, NAT-proof and free to host.
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
npm test                                  # 19 unit tests
node scripts/smoke.mjs http://localhost:8765   # 13-check end-to-end relay smoke
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
* ☐ live video viewfinders (WebRTC + TURN) — the `vynt-live` upgrade
* ☐ rooms for more than two
* ☐ countdown speed presets, collages with captions, strip-as-GIF
* ☐ a card on [yash-tripath1.github.io/Vynt](https://yash-tripath1.github.io/Vynt/) pointing here

## Credits

Built on the VYNT family:
[VYNT](https://github.com/Yash-Tripath1/Vynt) (filter maths © 2026 Anadi Tripathi) ·
[VYNT for Google Meet](https://github.com/Yash-Tripath1/vynt-meet). MIT — see `LICENSE`.
