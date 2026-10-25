# Reference inspection · 24 October 2026

The Jaipur renderer is original implementation code. No upstream source file, adapter, trained weight, photographic tile, or example artwork from the projects below is reused in the application. Small upstream source files were cached in ignored `data/references/upstream/` for inspection. This distinction matters: a source-code license does not grant rights to the map imagery, training examples, or model weights mentioned by that source.

## Visual study

Live pages were opened in an isolated Chrome browser, screenshots saved, and the resulting screenshots visually inspected. These research captures remain outside version control and are not bundled with the viewer.

| Reference | Observed result | Design consequence |
| --- | --- | --- |
| [tinygyn](https://tinygyn.com/) | Live Goiânia civic-plaza view loaded; capture `data/references/screenshots/tinygyn.png`. Bright sandstone paths and grey roads, many distinct roofs and parapets, tightly grouped green tree crowns with cool dark shadows, fine clean edges. | Primary visual ambition is high-bit richness at building scale. A few flat roof boxes or enlarged canvas pixels do not meet this bar. Jaipur uses its own footprint geometry and materials. |
| [Author's Goiânia X post](https://x.com/xthomasms/status/2113641952931377428) | Web request returned HTTP 403. | Video frames were **not watched**. No motion or construction process is inferred from inaccessible frames. |
| [tiny.london](https://tiny.london/) | Live map loaded in night/rain mode, with dense parallel roof forms and Thames edges; capture `data/references/screenshots/tiny-london.png`. | Readable minification, compact search and minimap are useful. Night shading is not adopted for this bright pilot. |
| [tiny.london/how](https://tiny.london/how/) | Full live article read in Chrome; initial text-fetch tool failed. Screenshot and extracted research text cached locally. | Keep one global orthographic pixel lattice. Joint denoising shares a latent and aggregates window predictions every step. Image-decoder border artifacts require separate review from sampler overlap. Preserve sparse source areas and inspect water hallucinations. Its newer Qwen model, cloud hardware, data sources and fine-tuning rights are not assumed applicable here. |
| [isometric.nyc](https://isometric.nyc/) | Live dense Manhattan map loaded; capture `data/references/screenshots/isometric-nyc.png`. Muted greys/tans, extremely detailed roof and window silhouettes, consistent projected streets. | DZI streaming and separate generation/viewing are appropriate. NYC density, palette, landmarks and branding are not Jaipur references. |
| [Isometric NYC process](https://cannoneyed.com/projects/isometric-nyc) | Author's article read. | Useful account of controlled geometry, generation state, fine-tuning and manual review. It documents costly failures in water/trees and seam repair. Its quoted cloud cost is not a Jaipur budget. |

The screenshot files are reference observations, not licensed production textures or training material. The normal viewer never requests these websites.

## Exact source revisions and inspected APIs

| Repository | Exact inspected HEAD | License actually found | Reused files |
| --- | --- | --- | --- |
| [cannoneyed/isometric-nyc](https://github.com/cannoneyed/isometric-nyc/tree/008446357ec67512c4329d25edefb6c508c7b24d) | `008446357ec67512c4329d25edefb6c508c7b24d` | Root `LICENSE`: MIT, Copyright © 2025 Andy Coenen | None |
| [RayNCooper/iso-cities](https://github.com/RayNCooper/iso-cities/tree/bf09d9da33230f04f8cf18c1e39364569c484890) | `bf09d9da33230f04f8cf18c1e39364569c484890` | Root `LICENSE`: MIT, Copyright © 2026 Dennis Reinkober; explicit separate ODbL map-data notice. GitHub API labels it `NOASSERTION`, so the actual file was read. | None |
| [JustinChavez/sf-isometric-demo](https://github.com/JustinChavez/sf-isometric-demo/tree/cf6f6ff4422b584dcd0447d73f316329229e2668) | `cf6f6ff4422b584dcd0447d73f316329229e2668` | No license file in the recursive tree; API reports no license. No general reuse grant assumed. | None |
| [omerbt/MultiDiffusion](https://github.com/omerbt/MultiDiffusion/tree/69bcdcef437dfdbf48c53624d6bf6f397b5f4894) | `69bcdcef437dfdbf48c53624d6bf6f397b5f4894` | No root license file. `pipeline_controlnet.py` has a Hugging Face Apache-2.0 header; this does not automatically license every other file. | None |
| [tashasho/cityscope](https://github.com/tashasho/cityscope/tree/50be7790b084ee57b5202ea6f3eb677ea1eba525) | `50be7790b084ee57b5202ea6f3eb677ea1eba525` | README and package metadata say MIT, but no actual license file or complete MIT grant in the tree. No source copied. | None |

For **isometric-nyc**, inspected `README.md`, `LICENSE`, `docs/app.md`, `docs/data.md`, `docs/generation.md`, `src/web_render/main.js`, `src/web_render/package.json`, `src/isometric_nyc/generation/export_dzi.py`, and the app's `README.md`, `package.json`, `src/config.ts`, `src/components/IsometricMap.tsx`. The renderer fixes pixel ratio to one and selects orthographic framing. Generation keeps quadrants, masks and source/config metadata. The exporter uses pyvips joins and `dzsave`, declaring zero overlap upstream. The app uses OpenSeadragon viewport/image conversion and production URL configuration. Jaipur instead uses a standard local DZI descriptor with its own declared overlap, explicit projection metadata and no production URL or private OSD patches.

For **iso-cities**, inspected `README.md`, `LICENSE`, `ATTRIBUTION.md`, `package.json`, `src/index.ts`, `src/osm/classify.ts`, `src/scene/build.ts`, `src/render/render.ts`, `src/render/iso.ts`. Current public entrypoint is `renderCity(query, options)`; lower-level exports include `buildScene`, `renderScene`, `createProjector` and `encodePng`. Height classification prefers explicit height over levels over defaults; its result does not retain a provenance field for that choice. Its 2:1 dimetric projector uses east/south/up with painter depth. Jaipur keeps height provenance and uses a depth-buffered Three.js scene instead of integrating this renderer.

For **sf-isometric-demo**, inspected `README.md`, `package.json`, `app.js` and repository tree. It publishes a finite downtown baseline, overview/quadrants and landmark jumps. It is not a general geometry or full-city generation system. This supports an explicitly bounded pilot UI, not copying its images.

For **MultiDiffusion**, inspected `README.md`, `panorama.py`, `region_based.py`, `pipeline_controlnet.py`. The panorama code uses Stable Diffusion UNet windows over one latent; within every scheduler timestep it accumulates overlapping denoised windows and normalises by counts. Qwen's transformer, conditioning, packed spatial positions and flow scheduler are different. No claim is made that these older APIs run Qwen or that joint-window Qwen inference is implemented here. The [ICML research paper](https://arxiv.org/abs/2302.08113) is a conceptual reference.

For **cityscope**, inspected `README.md`, `package.json`, `public/cities/bangalore.html`, `public/cities/mumbai.html` and full repository tree. The canvas map fills a city mask procedurally, generates streets/buildings and places event venues. Compact controls and distinct neighbourhood character are relevant; the procedural fill is inappropriate as authoritative Jaipur geometry.

## Landmark references and reconstruction bounds

**Hawa Mahal.** [Rajasthan Tourism](https://www.tourism.rajasthan.gov.in/hawa-mahal.html) describes a five-storey, narrowing honeycomb facade with many jharokhas; [its Jaipur page](https://www.tourism.rajasthan.gov.in/jaipur.html) supports the pink sandstone and courtyard interpretation. Footprint geometry and road alignment locate the asset. The facade belongs along the eastern street-facing side, not wherever it faces the camera most attractively. Tiers, windows and ornamental rhythm are authored abstractions, not surveyed counts. Approximate 15 m architectural height and thickness must remain labelled as inferred; the consulted official pages do not establish metric dimensions. Reference photographs are viewed for form only, never embedded as textures.

**City Palace.** The [official City Palace Museum](https://citypalace.org/) names Mubarak Mahal, Sarvato Bhadra and Pritam Niwas Courtyard and describes a multi-building complex. Render the separately mapped structures, their positions and open courts; do not extrude the entire palace site boundary. Decoration and heights are artistic estimates unless separately tagged. A courtyard remains open even if this is less visually dense than the reference cities.

**Jantar Mantar.** [UNESCO](https://whc.unesco.org/en/list/1338/) identifies the fixed masonry instruments and explains the surviving site's restoration history. [The specialist Jantar Mantar project](https://jantarmantar.org/learn/observatories/instruments/samrat/index.html) describes the triangular gnomon and quadrants. Its [measurement-based modelling study](https://jantarmantar.org/gallery/renderingsSamrat/index.php) gives the Jaipur gnomon as approximately 22.6 m; different sources quote larger overall heights including upper structures, so this is not survey certainty. The gnomon plane is aligned true north–south; its inclined edge rises northward near 27°, approximately the site's latitude. The site's [research publication](https://www.jantarmantar.org/resources/Articles/Architecture_Science_web.pdf) contains a site plan and photographs. Original simplified instruments may use those structural facts with OSM centres/footprints. Do not copy their 3D models, imagery or diagrams: no broad asset reuse grant was established.

All three custom forms are **artistic reconstructions**. Exact positioning comes from mapped geometry wherever available; dimensions, decoration and any inferred alignment remain disclosed in metadata and the viewer. No decorative building is invented outside an explicitly authored landmark footprint.

## isometric-malaga.pages.dev · inspected 26 October 2026

Opened live in the built-in browser; page source, `tiles/config.json` and `tiles/gen.dzi` read. Nothing copied.

| Aspect | Observed | Our position |
| --- | --- | --- |
| Tiling | One DZI, `Format="webp"`, `TileSize=512`, `Overlap=1`, 91,136 × 26,624 px (178 × 52 tiles at full res). Static files on Cloudflare Pages. | Same pyramid shape as ours (512 / overlap 1 / WebP, 58,368 × 47,104). Confirms R2/Pages static hosting is enough for tiles. No change. |
| Image source | `config.json` notes a generative pass ("Colab bf16 redraws", sea fixes, clean mask) over the base. | Our layers are deterministic renders; no generative layer. Not adopted (rights/provenance stance unchanged). |
| Viewer | Vanilla OpenSeadragon 5, canvas drawer, built-in navigator (bottom-left, autofade off), `maxZoomPixelRatio 8`, `minZoomImageRatio 0.5`, `zoomPerScroll 1.35`, `animationTime 0.9`. | Comparable; we keep our own React minimap and 4× max zoom (beyond 4× the render has no extra detail). |
| Pixel smoothing | Smoothing toggled on **device** pixels: `imageZoom × devicePixelRatio < 1.01`. | **Adopted** in `App.tsx`: we used CSS pixels, which blurred 50–99% zoom on 2× screens. |
| Labels / search | None. No POI labels, no search, no share state beyond `#z=&x=&y=`. | We are ahead (ranked search, close-zoom labels, filters, v2 share links). |
| Interaction | 🎲 button / `R` key flies to a random one of 20 hard-coded landmarks using a **shuffle bag** (all visited before repeats), shows a 4.5 s badge; `F` fullscreen; `0` home. Portrait-mobile tuned fit rectangles. | **Adopted** the shuffle-bag random landmark (dice button + `R`), driven by our curated POIs instead of hand-tuned tile coordinates. Fullscreen not added (browser chrome already minimal). |
| Renderer | No renderer code is public on the site. | No change to `tools/capital/scene.mjs`: nothing observed shows a clear improvement to our deterministic scene. |

## UI motion study · 26 October 2026

Sources I read before adding animation: [NN/g, "Executing UX Animations: Duration and Motion Characteristics"](https://www.nngroup.com/articles/animation-duration/), the Material 3 easing tokens (emphasized-decelerate `cubic-bezier(0.05, 0.7, 0.1, 1)` for entrances), and the [tiny.london build notes](https://tiny.london/how/).

| Finding | Applied |
| --- | --- |
| NN/g: most UI motion should take 100–400 ms; small feedback ~100 ms; panels 200–300 ms; exits shorter than entrances; frequent animations should be the most subtle; honour reduced motion. | Panels, menus, toasts and cards rise in over 180–260 ms with emphasized-decelerate easing. Exits are instant. Button press is a 100 ms scale. Everything is switched off by the existing `prefers-reduced-motion` rule. |
| tiny.london: ambient animation (its clouds) only runs while visible on screen, at a capped 15 fps. | The motion overlay caps at 30 fps, skips work for off-screen roads, lamps and windows, redraws static scenes only when the view changes, and pauses in hidden tabs. |
| tiny.london: coarse levels stand in smoothly while sharper tiles load. | Layer switches cross-fade over 900 ms instead of swapping, so the new layer's tiles appear softly. |
| Málaga (above): random-landmark fly-to with a short badge. | Already adopted. Pins now pop in (220 ms spring) when they appear. |
