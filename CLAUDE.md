# CLAUDE.md

Project-specific guidance for Claude Code working in this repository.

## This is a fork

- `origin` → `github.com/walters954/Recordly` (our fork)
- `upstream` → `github.com/webadderallorg/Recordly` (the app we forked from)

We periodically merge `upstream/main` into our `main` to pull in the latest
upstream work. **When merging upstream, our custom features below MUST be
preserved.** Some of our changes live in files upstream also edits, so a plain
merge can silently drop them even in files that don't show a conflict — verify
with `npx tsc --noEmit` and `npx vitest --run` after every upstream merge.

### Upstream merge checklist

1. Branch a backup first: `git branch backup-main-before-upstream-sync-<date> main`.
2. `git fetch upstream` then `git merge upstream/main`.
3. Resolve conflicts by keeping **both** sides where the changes are unrelated
   additions — our features are almost never an either/or against upstream.
4. Run `npx tsc --noEmit`. Dangling references (e.g. a call site whose helper
   was dropped during auto-merge) surface here — restore the missing piece from
   our pre-merge tip rather than deleting the call.
5. Run `npx vitest --run` — all of our custom-feature suites must stay green
   (see below).
6. `npx biome lint <changed files>` (warnings are fine; errors are not).

## Our custom features (do not lose these)

These are the changes we've implemented on top of upstream. Keep them intact.

### Cursor-follow crop + text-cursor focus
Per-frame viewport pan within the source video that keeps the cursor framed,
with a safe-zone inset and smoothing. Includes a "text cursor focus" mode that
gently pans to center the I-beam (the typing spot) while typing, snapping back
to mouse-following the moment the mouse moves.
- `src/components/video-editor/videoPlayback/cursorFollowCrop.ts`
- `src/components/video-editor/videoPlayback/cursorFollowCamera.ts`
- `CursorFollowCropSettings` / `DEFAULT_CURSOR_FOLLOW_CROP` in `src/components/video-editor/types.ts`
- Applied per-frame in `src/components/video-editor/VideoPlayback.tsx`
- Tests: `cursorFollowCrop.test.ts`, `cursorFollowCamera.test.ts`

### Text-zoom layer
An independent punch-in that eases a zoom onto the typing spot during sustained
typing, then eases back out when the mouse moves. Separate from the crop pan and
from explicit zoom regions (explicit zooms always win).
- `src/components/video-editor/videoPlayback/cursorTextZoom.ts`
- `textZoomEnabled` / `textZoomDepth` in `CursorFollowCropSettings` (`types.ts`)
- Applied in `VideoPlayback.tsx`
- Tests: `cursorTextZoom.test.ts`

### Connected-zoom transition logic
Interpolated pan/scale between chained (connected) zoom regions.
`findDominantRegion` returns a `transition` object that `VideoPlayback.tsx`
consumes to interpolate between the start/end transforms.
- `getConnectedRegionTransition`, `ConnectedPanTransition`, `easeConnectedPan`,
  `lerp`, `getLinearFocus` in `src/components/video-editor/videoPlayback/zoomRegionUtils.ts`
- The `if (transition) { … }` block in `VideoPlayback.tsx`
- ⚠️ This is the piece most likely to be silently dropped on an upstream merge —
  the call site can survive while the helpers/consumer get removed. Confirm both
  ends are present.

### Waveform generation guards
Low-sample-rate decode plus a file-size ceiling to avoid OOMing the renderer on
large media.
- `WaveformGenerator.MAX_DECODE_BYTES` (200 MB guard) and
  `WAVEFORM_DECODE_SAMPLE_RATE` in
  `src/components/video-editor/audio/waveform/WaveformGenerator.ts`
- Keep these alongside upstream's versioned waveform cache
  (`getAudioResourceCacheScope` / `getAudioResourceVersionKey`).

## Dev / verification commands

- Typecheck: `npx tsc --noEmit`
- Tests: `npx vitest --run`
- Lint: `npx biome lint .`
- Do not run `npm run dev` — assume the dev server is already running.
