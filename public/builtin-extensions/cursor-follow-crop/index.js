/**
 * Cursor Follow Crop — Recordly built-in extension
 *
 * Registers a crop transform hook that pans the viewport each frame so the
 * cursor stays inside a configurable safe-zone inset. An optional text cursor
 * focus mode locks the viewport to the typing area (I-beam cursor, stationary
 * mouse) and smoothly switches back to mouse tracking when movement resumes.
 */

// ---------------------------------------------------------------------------
// Algorithm constants
// ---------------------------------------------------------------------------

const MOUSE_MOVE_THRESHOLD = 0.008;
const MOUSE_ACTIVE_WINDOW_MS = 400;
const MOUSE_ACTIVE_DEBOUNCE_MS = 700;
const TEXT_CURSOR_SMOOTHNESS = 0.92;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

function clampSafeZoneRatio(r) {
  if (!Number.isFinite(r)) return 0.25;
  return Math.max(0, Math.min(0.49, r));
}

function clampSmoothness(s) {
  if (!Number.isFinite(s)) return 0.5;
  return Math.max(0, Math.min(1, s));
}

function clampViewportSize(v) {
  if (!Number.isFinite(v) || v <= 0) return 1;
  return Math.min(1, v);
}

/** Interpolate cursor position at timeMs from a sorted sample array. */
function interpolateCursor(samples, timeMs) {
  if (!samples || samples.length === 0) return null;

  let lo = 0;
  let hi = samples.length - 1;

  if (timeMs <= samples[0].timeMs) return { cx: samples[0].cx, cy: samples[0].cy };
  if (timeMs >= samples[hi].timeMs) return { cx: samples[hi].cx, cy: samples[hi].cy };

  // Binary search for surrounding samples
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].timeMs <= timeMs) lo = mid;
    else hi = mid;
  }

  const a = samples[lo];
  const b = samples[hi];
  const span = b.timeMs - a.timeMs;
  if (span <= 0) return { cx: a.cx, cy: a.cy };
  const t = (timeMs - a.timeMs) / span;
  return { cx: a.cx + (b.cx - a.cx) * t, cy: a.cy + (b.cy - a.cy) * t };
}

/**
 * Compute the viewport top-left so the cursor stays inside the safe-zone
 * inset. Returns current position if cursor is already inside.
 */
function computeTargetPosition(curX, curY, vpW, vpH, cx, cy, safeZoneRatio) {
  const ratio = clampSafeZoneRatio(safeZoneRatio);
  const insetX = vpW * ratio;
  const insetY = vpH * ratio;

  let nextX = curX;
  let nextY = curY;

  if (cx < curX + insetX) nextX = cx - insetX;
  else if (cx > curX + vpW - insetX) nextX = cx - (vpW - insetX);

  if (cy < curY + insetY) nextY = cy - insetY;
  else if (cy > curY + vpH - insetY) nextY = cy - (vpH - insetY);

  const maxX = Math.max(0, 1 - vpW);
  const maxY = Math.max(0, 1 - vpH);
  return { x: clamp(nextX, 0, maxX), y: clamp(nextY, 0, maxY) };
}

/** Per-frame ease factor: higher smoothness = slower follow. */
function getResponseFactor(smoothness, dtMs) {
  const s = clampSmoothness(smoothness);
  if (s <= 0) return 1;
  if (s >= 1) return 0;
  const responsePerSecond = 20 * (1 - s) + 1;
  const dtSec = Math.max(0, Math.min(0.25, dtMs / 1000));
  return 1 - Math.exp(-responsePerSecond * dtSec);
}

/** True if mouse moved enough in MOUSE_ACTIVE_WINDOW_MS before timeMs. */
function detectMouseActivity(samples, timeMs) {
  const windowStart = timeMs - MOUSE_ACTIVE_WINDOW_MS;
  let prev = null;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.timeMs > timeMs + 50) continue;
    if (s.timeMs < windowStart) break;
    if (prev !== null) {
      const dx = prev.cx - s.cx;
      const dy = prev.cy - s.cy;
      if (dx * dx + dy * dy >= MOUSE_MOVE_THRESHOLD * MOUSE_MOVE_THRESHOLD) return true;
    }
    prev = s;
  }
  return false;
}

/** True if the cursor type at/before timeMs is the text I-beam. */
function isTextCursorActive(samples, timeMs) {
  if (!samples || samples.length === 0) return false;
  for (let i = samples.length - 1; i >= 0; i--) {
    if (samples[i].timeMs <= timeMs + 50) return samples[i].cursorType === "text";
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-frame algorithm
// ---------------------------------------------------------------------------

function computeCrop(state, samples, timeMs, base, safeZoneRatio, smoothness, trackTextCursor) {
  const width = clampViewportSize(base.width);
  const height = clampViewportSize(base.height);
  const maxX = Math.max(0, 1 - width);
  const maxY = Math.max(0, 1 - height);
  const fallbackX = clamp(base.x, 0, maxX);
  const fallbackY = clamp(base.y, 0, maxY);

  const cursor = interpolateCursor(samples, timeMs);

  if (!cursor) {
    if (!state.initialized) {
      state.x = fallbackX;
      state.y = fallbackY;
      state.initialized = true;
      state.lastTimeMs = timeMs;
      state.mouseLastMovedMs = timeMs;
    }
    return { x: state.x, y: state.y, width, height };
  }

  const cx = clamp(cursor.cx, 0, 1);
  const cy = clamp(cursor.cy, 0, 1);

  const timeWentBackwards = state.initialized && timeMs + 0.5 < state.lastTimeMs;
  if (!state.initialized || timeWentBackwards) {
    const initial = computeTargetPosition(fallbackX, fallbackY, width, height, cx, cy, safeZoneRatio);
    state.x = initial.x;
    state.y = initial.y;
    state.initialized = true;
    state.lastTimeMs = timeMs;
    state.mouseLastMovedMs = timeMs;
    state.focusMode = "mouse";
    return { x: state.x, y: state.y, width, height };
  }

  // Update focus mode when text cursor tracking is enabled
  if (trackTextCursor) {
    if (detectMouseActivity(samples, timeMs)) {
      state.mouseLastMovedMs = timeMs;
      state.focusMode = "mouse";
    } else if (
      state.focusMode !== "text" &&
      timeMs - state.mouseLastMovedMs > MOUSE_ACTIVE_DEBOUNCE_MS &&
      isTextCursorActive(samples, timeMs)
    ) {
      state.focusMode = "text";
    }
  } else {
    state.focusMode = "mouse";
  }

  const effectiveSmoothness =
    trackTextCursor && state.focusMode === "text"
      ? Math.max(smoothness, TEXT_CURSOR_SMOOTHNESS)
      : smoothness;

  const target = computeTargetPosition(state.x, state.y, width, height, cx, cy, safeZoneRatio);
  const dtMs = Math.max(0, timeMs - state.lastTimeMs);
  const factor = getResponseFactor(effectiveSmoothness, dtMs);
  state.x = clamp(state.x + (target.x - state.x) * factor, 0, maxX);
  state.y = clamp(state.y + (target.y - state.y) * factor, 0, maxY);
  state.lastTimeMs = timeMs;

  return { x: state.x, y: state.y, width, height };
}

// ---------------------------------------------------------------------------
// Extension state
// ---------------------------------------------------------------------------

function createState() {
  return { initialized: false, lastTimeMs: 0, x: 0, y: 0, focusMode: "mouse", mouseLastMovedMs: -Infinity };
}

let cropState = createState();

// ---------------------------------------------------------------------------
// Extension lifecycle
// ---------------------------------------------------------------------------

export async function activate(api) {
  cropState = createState();

  api.registerSettingsPanel({
    id: "cursor-follow-crop",
    label: "Cursor Follow Crop",
    icon: "Crop",
    parentSection: "crop",
    fields: [
      {
        id: "enabled",
        label: "Track cursor",
        type: "toggle",
        defaultValue: false,
      },
      {
        id: "safeZoneRatio",
        label: "Safe zone",
        type: "slider",
        defaultValue: 0.25,
        min: 0,
        max: 0.49,
        step: 0.01,
      },
      {
        id: "smoothness",
        label: "Smoothness",
        type: "slider",
        defaultValue: 0.5,
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        id: "trackTextCursor",
        label: "Text cursor focus",
        type: "toggle",
        defaultValue: false,
      },
    ],
  });

  // Reset internal state whenever a key setting changes so the viewport
  // doesn't snap when the user adjusts sliders mid-playback.
  api.onSettingChange((settingId, _value) => {
    if (
      settingId === "enabled" ||
      settingId === "safeZoneRatio" ||
      settingId === "trackTextCursor"
    ) {
      cropState = createState();
    }
  });

  api.registerCropTransformHook((baseCrop, ctx) => {
    if (!api.getSetting("enabled")) return baseCrop;

    const safeZoneRatio = Number(api.getSetting("safeZoneRatio") ?? 0.25);
    const smoothness = Number(api.getSetting("smoothness") ?? 0.5);
    const trackTextCursor = Boolean(api.getSetting("trackTextCursor"));

    return computeCrop(
      cropState,
      ctx.cursorTelemetry,
      ctx.timeMs,
      baseCrop,
      safeZoneRatio,
      smoothness,
      trackTextCursor,
    );
  });

  api.log("Cursor Follow Crop activated");
}

export async function deactivate() {
  cropState = createState();
}
