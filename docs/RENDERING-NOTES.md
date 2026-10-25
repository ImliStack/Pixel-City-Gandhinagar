# Emissive shaders, depth buffers and render passes — as used in Pixel City

All references are to [tools/capital/scene.mjs](../tools/capital/scene.mjs) (Three.js r180, WebGL2 in headless Chrome on Apple M3 / ANGLE-Metal).

## 1. Render passes

A *pass* is one complete draw of (part of) the scene into a target — the screen, or an off-screen texture that a later pass reads. A frame is a sequence of passes.

What one chunk of this map goes through:

| # | Pass | Target | What it does |
|---|------|--------|--------------|
| 1 | **Shadow pass** | 4096² depth texture (shadow map) | Renders every shadow-casting mesh *from the sun* with an orthographic camera and stores only depth. |
| 2 | **Opaque colour pass** | canvas (or render target in mode B) | Draws buildings, ground, trees, roads. Each fragment runs the Lambert shader, which samples the shadow map to decide "lit or in shadow". |
| 3 | **Transparent pass** | same target | Draws the night light pools last (`renderOrder = 2`, additive blending, no depth writes). |
| 4 | *(mode B only)* **RenderPixelatedPass** | colour + normal + depth targets | Re-renders the scene into three textures, then a full-screen shader darkens pixels where neighbouring normals or depths jump — the 1 px edge treatment (`normalEdgeStrength 0.16`, `depthEdgeStrength 0.20`). |
| 5 | *(mode B only)* **OutputPass** | canvas | Converts the linear-light result to sRGB for display. Without it B would look darker than A. |

`EffectComposer` chains passes 4–5 by ping-ponging between two render targets: each pass reads the previous pass's texture and writes the other one.

Why no bloom pass for night glow: bloom blurs bright pixels over tens of pixels using a mip chain whose sampling grid depends on canvas size. Different chunks would blur slightly differently, which shows up as seams. The 160 px chunk padding hides neighbourhood effects only up to that radius, and the deterministic-continuity test (mean 0.0008/255 for night) would no longer hold.

## 2. Depth buffers

The depth buffer stores, per pixel, the distance to the nearest surface drawn so far. Before a fragment is written its depth is compared with the stored one; farther fragments are discarded (*depth test*). That is how a roof hides the street behind it without sorting geometry.

**Orthographic depth is linear.** The camera here is orthographic (`near 1`, `far 3000` m), so depth precision is uniform: a 24-bit buffer resolves 3000 / 2²⁴ ≈ 0.18 mm. Perspective cameras concentrate precision near the lens; ours does not need to.

**Z-fighting and layer offsets.** Two coplanar surfaces with different colours produce flickering stripes because their depths are equal within rounding. Ground layers are therefore stacked a few centimetres apart: noise ground −0.02 m, landuse 0.01, yards 0.03–0.054, sidewalks 0.08, parks 0.09, parking 0.10, water 0.11, roads 0.12, curbs 0.13, light pools 0.22. Overlapping plot yards share one colour per compound for the same reason.

**Shadow maps are depth buffers seen from the sun.** In pass 1 the light's depth buffer records the first surface along each sun ray. In pass 2 each fragment is projected into that map; if something closer to the sun was recorded, the fragment is shadowed. Practical consequences in this code:

- `shadow.bias = −0.0002` and `normalBias = 0.06` stop surfaces shadowing themselves ("shadow acne") from rounding.
- The shadow camera covers ±300 m around each chunk (0.15 m per texel) and its centre is **snapped to the light-space texel grid**, so neighbouring chunks sample identical shadow texels — that is what keeps chunk seams near zero.
- `PCFSoftShadowMap` with `radius` softens edges (2 in summer, 7 under monsoon overcast).

**Turning depth writes off.** Light pools use `depthWrite: false`: they are still hidden behind buildings (depth *test* on) but do not hide each other, so overlapping pools add up instead of clipping.

**Depth as an image signal.** Mode B's edge shader reads the depth texture: a large depth step between neighbouring pixels marks a silhouette (roof edge against street).

## 3. Emissive shaders

Lambert shading computes, per fragment:

```
colour = emissive + albedo × (ambient + Σ lights · max(0, N·L) · shadow)
```

`emissive` is light the surface *gives off*. It is added after lighting, so it is unaffected by night-time darkness and by shadows. In `material()` any colour in the `EMISSIVE` set becomes

```js
new MeshLambertMaterial({ color: '#1a1a1a', emissive: '#ffd27a', emissiveIntensity: 1.15 })
```

— nearly black albedo (it barely reflects moonlight) plus a warm self-lit term. That is how night windows, shop shutters, lamp heads and the metro deck strip glow.

What emissive does **not** do: it does not illuminate anything else. A lit window does not brighten the wall below it. Real local lights would need one shader light per lamp (thousands — too slow in forward rendering), deferred shading, or baked light maps. The map fakes the result instead: under each lamp a 20-segment disc carries vertex colours bright at the centre and black at the rim, drawn with **additive blending** (`src + dst`). Black adds nothing, so only the warm falloff shows, and overlapping pools sum like real light.

Day/night consistency: night uses the same geometry. The lit/unlit choice for each window comes from a separate random stream (`hash(id) + 777`), so switching layers never moves a building, tree or roof tank — only light, palette and emissive terms change.

## 4. How the climate layers differ

| Layer | Sky / ground light | Sun | Shadows | Palette changes |
|---|---|---|---|---|
| Summer day (A) | `#a9c6e4` / `#7a7556`, 1.35 | warm, 3.2, from SW | radius 2 | dry grass and earth |
| Monsoon | brighter overcast 1.95 | weak 1.45 | radius 7 (diffuse) | lush ground, darker wet roads, cloud-shadow noise, puddles |
| Winter morning | cool 1.2 | low, long shadows (up 330 vs 420) | radius 2 | paler drier ground, olive foliage, one tree variant in autumn colour |
| Night | blue moonlight 0.48 | 0.48 | radius 3 | emissive windows/lamps, additive light pools |

All four layers share one pixel lattice, so the viewer can swap them without moving the view.
