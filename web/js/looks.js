// The VYNT looks as GPU work.
//
// Live video is shown as real decoded video (native framerate, GPU composited), so the
// look has to live in the compositor too: a filter chain on the media, plus grain,
// scanline and vignette layers on top. The exact VYNT pixel code still runs for the
// photos (see filters.js), so what you keep matches the original app pixel for pixel.

export const LOOKS = {
  original: { css: 'none', grain: 0.55, scan: 0, vig: 0 },
  vyntage: { css: 'sepia(0.24) saturate(1.12) contrast(0.92) brightness(1.07)', grain: 0.8, scan: 0, vig: 0.32 },
  digicam: { css: 'saturate(1.15) contrast(1.08) brightness(1.02)', grain: 0.72, scan: 0, vig: 0.28 },
  nightflash: { css: 'grayscale(0.52) brightness(1.2) contrast(1.14)', grain: 1, scan: 0, vig: 0.8 },
  neoncity: { css: 'saturate(1.85) hue-rotate(-8deg) contrast(1.13) brightness(1.02)', grain: 0.55, scan: 0.4, vig: 0.18 },
  vhs: { css: 'saturate(0.72) contrast(1.06) brightness(1.03) sepia(0.12)', grain: 1, scan: 0.85, vig: 0.12 },
  goldenfilm: { css: 'sepia(0.38) saturate(1.34) brightness(1.07) contrast(0.93)', grain: 0.5, scan: 0, vig: 0.28 },
  fisheye: { css: 'saturate(1.1) contrast(1.03) brightness(1.01)', grain: 0.45, scan: 0, vig: 0.6, zoom: 1.06 },
}

/**
 * Paint the current settings onto the panes: media filter chain, layer opacities,
 * pixel size, mirror (self view only), stamp. Both panes read one shared settings
 * object, so both screens stay identical.
 * @param {HTMLElement[]} panes
 */
export function applyLook(panes, settings) {
  const look = LOOKS[settings.filterMode] || LOOKS.original
  const grain = Math.max(0, Math.min(1, (settings.grain / 100) * look.grain))
  for (const pane of panes) {
    pane.style.setProperty('--look-filter', look.css)
    pane.style.setProperty('--look-grain', String(grain))
    pane.style.setProperty('--look-scan', String(look.scan))
    pane.style.setProperty('--look-vig', String(look.vig))
    pane.style.setProperty('--zoom', String(look.zoom || 1))
    pane.style.setProperty('--px', String(Math.max(1, Math.round(settings.pixelSize || 1))))
    pane.style.setProperty('--mirror', pane.dataset.mirror === 'self' && settings.mirror ? '-1' : '1')
    pane.classList.toggle('no-stamp', !settings.stamp)
  }
}
