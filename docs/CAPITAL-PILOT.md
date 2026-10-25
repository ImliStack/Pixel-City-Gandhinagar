# Gandhinagar capital pilot

State as of 2026-10-25. Supersedes the "viewer paused" note in [VISUAL-MILESTONE.md](VISUAL-MILESTONE.md): the geographic pipeline and viewer are finished; the artwork target is **not** met.

## Diagnosis of the visual gap

Findings from the v3 sample and the first capital render, in order of impact:

1. **Weak ground and vegetation, not missing pixels.** Opaque landuse fills painted large flat beige plates; trees existed only inside 19 mapped parks. The capital extract has 8 mapped tree nodes. Fix: world-anchored ground noise (dry grass / earth / lawn), layered instanced crowns, and an explicit authored planting mask (street verges, residential and greenfield land) that rejects roads, buildings, water, parking and pitches.
2. **Shadow resolution.** The untested Codex change stretched one 4096² shadow map over ±1350 m (0.66 m/texel, ~3 px blocks). Fix: per-chunk shadow camera (±300 m, 0.15 m/texel) snapped to a global light-space texel lattice so chunks still agree.
3. **Plain roofs.** Roof items required their centre inside a −3 m buffer and almost never fit. Fix: every corner must lie inside the −1.1 m parapet polygon; larger roofs get several deterministic items (black water tanks, stair cabins, AC units, solar rows) and a joint grid.
4. **Focal landmark.** The assembly was one huge flat plate; an OSM `building:part` (way/338492244, 9.6 m) sat hidden inside it. Fix: stepped roof tiers with clerestory windows and a ribbed dome, all inside the source footprint; the contained part is suppressed only in art modes and listed in `counts.replacedParts`. The model is an original approximation, not a survey.
5. **Missing infrastructure.** Metro Line 2 (`railway=subway`, `bridge=viaduct`) was dropped. Now drawn as deck, parapets and piers from the OSM alignment; height and pier spacing inferred.
6. **Not causes:** pixelation (B's 1 px edge pass is barely visible and harmless), viewer scaling (nearest-neighbour above 100 %, smoothing below), image generation (none exists).

Source-data limits that rendering cannot fix: sparse yard trees, no plot walls, two mapped parking lots, flat roofs in data, many unmapped small structures. Large open plots in the render are real open land.

## Renderer

`tools/capital/scene.mjs` (served by `tools/capital/index.html`) builds one scene in headless Chrome. `tools/capital/render.mjs` renders 1024 px chunks with 160 px padding as view offsets of a single orthographic camera, stores per-chunk SHA-256 in `job.json` with config/scene/code hashes, and stitches with Sharp. Modes: `source` (plain extrusions), `A` (stylised), `B` (A + `RenderPixelatedPass` pixelSize 1, normal 0.16, depth 0.20 + `OutputPass`).

The 2048² representative sample (`config/cities/gandhinagar-sample.json`) reuses the v3 camera, light, centre, resolution and OSM extract exactly, so [before/after sheets](../outputs/capital-sample/compare/) compare like with like.

Determinism: all procedural choices hash stable OSM IDs with seed 2031. An interrupted run (12/36 chunks) resumed to 36/36 chunks bit-identical with a previous uninterrupted run ([resume-test.json](../outputs/capital/resume-test.json)).

Continuity: a direct 2048² render across the chunk corner at (2048, 2048) differs from the stitched chunks by mean 0.0023/255 (A), 0.0034 (B); 0.07 % / 0.12 % of channels differ; max 187 at isolated soft-shadow pixels. Visual diff: `outputs/capital/render-*/seam-difference-x10.png`. No generative regions exist, so generative continuity is untested.

## Export and viewer

`tools/capital/export.mjs` writes `outputs/maps/gandhinagar-capital/{A,B,source}.dzi` (WebP q90, 512 px, overlap 1, 14 levels; basename without `.dzi`), `minimap.webp`, `metadata.json` (transform, coverage polygon from the projected acquisition bbox, POIs, render stats) and `ATTRIBUTION.txt`. `apps/viewer/public/maps` links to `outputs/maps`; `public/map` still serves the Jaipur export.

Viewer (`apps/viewer/src/App.tsx`): full-window OpenSeadragon, compact top search (English, Gujarati, kind, aliases; keyboard navigation), right control stack (north, zoom, reset, share, layers, info), lower-left minimap with live view rectangle and click/drag panning, curated pins from neighbourhood zoom, sector labels at overview, place card, missing-tile and stale-version notices, mobile layout. Home view fills the window.

## Verification

- `npm run verify`: 19 node tests (10 historical sample + 9 capital: provenance hash, CRS/camera round trip and landmark position, extent within acquisition bbox, holes/duplicates/part replacement, chunk hashes/offline/model-free/seams, resume, DZI addressing and pixel content, metadata, URL state) and 9 Python data tests.
- `npm run verify:browser`: 20/20 — wheel/drag, English and Gujarati search, pin exactly at viewport centre after a jump, share-link restore, stale-version notice, layer switch keeps view, minimap correspondence, reset, local fonts, missing tiles, mobile non-overlap / no horizontal scroll / zoom, no page errors, zero external requests. Report and screenshots: `outputs/qa/viewer/`.
- Historical v3 sample re-rendered through the Codex-modified `tools/sample/scene.mjs`: mean 0.47/255 difference, confined to roof equipment and tree edges (`outputs/qa/sample-regression/`). The stored v3 image was not overwritten.
- Demo: `outputs/demo/navigation-demo.mp4`, 37.2 s, 1440 × 900, chapters in `demo.json`.

Not verified: pinch on a physical touch device (only emulated tap); production `vite preview` build in a browser (build succeeds); tree-placement constraints by an independent test (they are enforced in placement code only; the one mapped OSM tree is exempt).

## Remaining gap to the reference

From [reference comparisons](../outputs/capital/reference-comparisons/) at estimated equal px/m (manual estimate from crown and lane widths):

- **00:38 housing:** reference has dense plots, pitched terracotta roofs, pools, compound walls and yard trees between houses. Ours: regular flat-roofed government blocks with tanks and cabins — plausible for Gandhinagar, but lower variety and less greenery between blocks.
- **00:10 / 00:26 infrastructure:** reference shows striped parking full of cars, crosswalks, lane arrows, paved plazas, varied roof membranes. Ours has two mapped lots with stripes, centre lines on wider roads, no vehicles, few paving types.
- **00:00 / 00:04 civic and park:** our crowns and park density are close in structure; reference crowns have richer hand-painted highlight clustering and the water has shoreline detail ours lacks.
- **Global:** surfaces read as clean flat-shaded CG; the reference has painterly micro-texture throughout. That gap needs either a texture/material pass or a local image-model stage.

## Next most valuable improvement

Plot-level detail inside mapped residential landuse: compound walls and gates along inferred plot lines, yard paving/lawn patches, and denser yard trees between blocks. This is the largest visible difference at neighbourhood scale and needs no model. After that, a bounded local image-model benchmark (512–1024 px, small licensed SD-class model with structural control) — only once a compatible workflow is verified on this 8 GiB machine.
