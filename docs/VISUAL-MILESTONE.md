# Gandhinagar visual milestone

> **Historical (v1–v3 sample).** Current work: [CAPITAL-PILOT.md](CAPITAL-PILOT.md). The pause on viewer work below was lifted; the art target remains unmet.

The active task is a **single continuous 2048 × 2048 sample in Gandhinagar, Gujarat**. Viewer work and geographic expansion are paused until visual quality is demonstrated. The earlier Jaipur outputs remain historical baselines, not a successful artwork milestone.

The user supplied `rJ_6Wzts91x6J0kx.mp4` (1956 × 1440, 60 fps, 39.288 s). Frames were actually extracted at 00:00, 00:04 and 00:38 with local FFmpeg. The video shows tinygyn / Goiânia, Brazil. It is not geographic evidence for Gandhinagar. Reference frames are research comparisons only, never geometry, textures, or training data.

Observed target traits:

- Fixed orthographic camera with parallel edges and moderately steep overhead elevation.
- White/neutral roof planes, strongly separated cool facades, visible parapets, ledges, windows and roof equipment.
- Trees built from overlapping irregular crown lobes, with sunlit chartreuse/green tops and deep cool shaded undersides; coherent cast shadows.
- Saturated but controlled color, crisply bounded streets and sidewalks, dark blue-grey daylight shadows.
- At 00:38, domestic roof widths generally span roughly 45–100 pixels in the native frame. Comparisons must be labelled and normalized by apparent building width rather than presented at mismatched zooms.

The original 20B Qwen image-edit checkpoint remains infeasible on this Apple M3 / 8 GiB machine. No model is downloaded or silently substituted. A richer original geometric illustration can be tested locally, but a procedural revision does **not** automatically pass the high-bit art target. Final results must show source geometry, baseline, the latest detailed candidate, comparisons, remaining defects, and seam checks separately. If insufficient, the milestone remains explicitly incomplete and expansion stays paused.

## Result: milestone incomplete

The latest image is `outputs/visual-milestone/artwork-candidate-v3.png`, exactly 2048 × 2048. It is a detailed **geometric illustration candidate**, not finished high-bit art. The separate source geometry and baseline share its final camera and extent. The ground window covers approximately 0.06321 km² and intersects 129 real building footprints and three mapped pocket gardens. Its center is 23.2249527094 N, 72.6385489515 E, beside G Road in Gandhinagar. The larger retained context contains 367 building pieces; that is not the number visible in the sample.

Local input: OpenStreetMap snapshot at 2026-10-25T08:08:35Z, downloaded as a single bounded 1,125,760-byte response after one transient 502 retry. SHA-256: `0a7f18f4f76fa3bbd555e25e606edd684f2551eee455e9f5eb1f67d7fc9ecff7`. The source and derived GeoJSON remain separate from the authored detail. No missing footprints, pools, roads or monuments were invented to imitate Goiânia. Tree positions inside mapped parks, roof equipment, openings and colors are illustrative assumptions.

## Actual workflow and settings

Python 3.9.6, pyproj 3.6.1 and Shapely 2.0.7 prepare UTM 43N metre geometry and union road surfaces/junctions. Three.js 0.180.0 renders the scene in local Chrome 155.0.8059.86 through `ANGLE Metal Renderer: Apple M3`. The machine has 8 GiB unified memory. Sharp 0.35.5 exports PNGs and contact sheets. No diffusion model, checkpoint, LoRA, cloud rendering, image-to-image service or post-render pixel filter was used.

Camera: fixed orthographic, azimuth 25°, elevation 55°, 9 px/metre; global top-left image coordinates. Flat ground. Revision 3 uses MeshLambertMaterial, seven muted facade choices (source color tags take priority), six roof colors, actual perimeter parapets, window frames/panes/sills, floor bands, doors and seed-varied rooftop details. Seed 2031 combines with stable OSM IDs. Vegetation uses 18 irregular crown lobes per tree plus small upper leaf clusters and a dark lower crown; placement remains inside mapped park polygons. Directional sunlight is offset (-180, -220, 420) metres from the ground center, intensity 3.5, plus a cool hemisphere intensity 1.05. Shadow map 4096², PCF shadows, bias -0.00012, normal bias 0.18. Surface meshes do not cast shadows, eliminating the earlier self-shadow speckle. Native-resolution rendering uses no antialiasing or nearest-neighbour enlargement of the finished image.

Latest measurement: approximately **0.92 seconds** for the detailed candidate's page loading, scene construction, render readback and PNG save; **5.63 seconds** for baseline, candidate, four adjacent regions and measurements together. Peak sampled Node+Chrome descendant RSS was **1,558.6 MiB**; shared memory may be double counted. Dedicated VRAM is not measured on Apple unified memory. The candidate PNG is about 1.2 MB. See `render-report.json` for exact unrounded measurements and settings. These timings do not include data download or any nonexistent AI generation.

## Visual review and revisions

v1 added facade openings and basic crown clusters to the baseline. v2 added roof equipment, finer crown lobes and leaf clusters. Review exposed repetitive roof layouts, weak material variation, washed-out shading, and self-shadow speckle. v3 varied rooftop placement and facade colors, added coping/curb detail, strengthened cool shadows, corrected surface shadow casting, and tightened the crop around the same mapped housing/garden neighbourhood. Historical v1/v2 have the earlier wider crop; they are retained and are not represented as registered pixel comparisons with v3.

The comparisons at 00:00, 00:04 and 00:38 use actual extracted frames. Their crop rectangles and display scales are recorded in `comparison-settings.json`; ordinary roofs/crowns have comparable apparent sizes, not an asserted shared geographic scale. Civic buildings in frame 00:00 differ in type from this residential sample. Reference frames and the candidate were visually inspected, including the full candidate and a close-up of the region boundary.

Remaining differences are substantial:

1. Buildings still read as repeated procedural extrusions with attached details. The reference has individually resolved roof planes, varied building masses and much stronger architectural identity.
2. Tree crowns remain too rounded and facet-heavy. The reference has more deliberate irregular pixel clusters, deeper inter-crown shadows and richer transitions between canopies.
3. Roads and ground are clean but too plain. Fine paving, plot edges and small observed street details are absent; broad unrecorded ground areas remain visibly empty.
4. The palette is still subdued compared with the reference. Simply adding orange roofs, swimming pools or unverified street trees would falsify Gandhinagar and is not an acceptable fix.
5. Facade dimensions, unknown heights and vegetation placement are inferred. More verified local architectural/planting detail is needed for a stronger geographically honest sample.

## Continuity and verification

Four adjacent 1024² renders use view offsets of one global camera and 160-pixel padding. Their mosaic was compared with the single 2048² render. Mean absolute channel difference: **0.00417/255**; a 16-pixel band around the seams: **0.00848/255**. About **0.0994%** of channels differ, and the maximum isolated difference is **211** at raster edges, so this is not bit-identical. The visual boundary contact sheet shows no broad discontinuity; the 10× difference image reveals sparse edge differences. This only establishes geometric-render continuity. **Image-model generation continuity was not tested.**

Five sample tests passed: distinct correct-size artifacts; geographic/image coordinate agreement; matching source provenance and zero external rendering requests; bounded adjacent-region difference; and all three reference comparisons with recorded scales. Tests do not award visual quality. No expansion or additional viewer work is authorized by this failed visual gate.

## Next work before expansion

Stay on this sample. Obtain suitably licensed local facade/roof/planting references; author a small set of locally appropriate, detailed building and tree assets without altering verified footprints; add observed ground detail; then repeat the three comparisons. A local image-edit alternative would first need a verified compatible checkpoint, license and measured 512px memory test on this machine. The previously inspected 20B Qwen checkpoint cannot fit, but that alone is not proof that every possible local artwork workflow is impossible. No smaller model has been benchmarked or claimed to solve the style. Continue viewer work only after a visibly convincing sample passes review.
