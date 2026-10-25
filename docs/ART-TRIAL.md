# Model repaint trial (cloud GPU)

**Why.** Isometric Málaga looks richer than our map because an image-edit model repainted its geometry render tile by tile. Its `tiles/config.json` mentions "Colab bf16 redraws". Our map is a deterministic WebGL render. This trial repaints **one crop** so we can judge the gain before spending on the whole city.

**Status:** scripts ready, not yet run. A run needs a rented GPU and your account. Nothing here runs on the 8 GB Mac.

## Steps

```bash
node tools/art/trial-prepare.mjs vidhan-sabha 3072 2048 A
```
This writes `outputs/art-trial/input-vidhan-sabha-A.png`: a 3072×2048 px crop around the Capital complex, taken from the exported tiles.

1. Upload that PNG and `tools/art/repaint_trial.py` to a GPU machine. Use RunPod or Lambda with an A100 80 GB or H100, or Colab Pro with an A100.
2. On the GPU machine:
   ```bash
   pip install torch diffusers transformers accelerate pillow
   python repaint_trial.py input-vidhan-sabha-A.png --out repainted.png
   ```
   With a 24 GB card, add `--offload` (much slower).
3. Bring back `repainted.png` and `repainted.json`, then run:
   ```bash
   node tools/art/trial-compare.mjs outputs/art-trial/input-vidhan-sabha-A.png outputs/art-trial/repainted.png
   ```
   This writes a side-by-side image and a 2× nearest-neighbour detail comparison.

## Model and licence

- **Qwen/Qwen-Image-Edit**, Apache-2.0. This is the same model already chosen in `tools/stylize/stylize.py`: about 58 GB of weights, needing roughly 40 GB or more of VRAM in bf16.
- The prompt asks it to preserve the camera, silhouettes, roads and water, and to add nothing new. The seed is fixed per tile, and tiles overlap by 192 px with a feathered blend.

## Cost estimate (assumptions, not quotes)

| Job | Tiles (1024 px, step 832) | At ~60 s/tile on an A100 | At ~$1.5–2 per GPU hour |
|---|---|---|---|
| This trial (3072×2048) | 12 | ~12 min | under $1 |
| Whole city, one layer (58,368×47,104) | ~4,000 | ~65–70 h | ~$100–140 |
| All 4 scene layers | ~16,000 | ~270 h | ~$400–550 |

## Review rules before anything ships

- Diff the repaint against the source and OSM footprints. Reject tiles that invent buildings, roads or water. Sea and tree hallucinations are the documented failure mode in isometric.nyc and Málaga.
- Label repainted layers as **model-assisted illustration** in the viewer and README. The deterministic layer stays available as the accurate reference.
- Check tile seams the same way `render.mjs --seam` does.
