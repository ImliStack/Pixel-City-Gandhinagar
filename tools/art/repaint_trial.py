#!/usr/bin/env python3
"""Cloud GPU repaint trial: redraw one crop of the deterministic render with an image-edit model,
tile by tile with overlap, then feather-blend. Run on a rented GPU (Colab / RunPod), NOT on the 8 GB Mac.

  pip install torch diffusers transformers accelerate pillow   # recent diffusers with QwenImageEditPipeline
  python repaint_trial.py input-vidhan-sabha-A.png --out repainted.png [--tile 1024 --overlap 192 --steps 30]

Model: Qwen/Qwen-Image-Edit (Apache-2.0, ~58 GB download; ~40 GB+ VRAM, or slower with CPU offload).
Determinism: fixed seed per tile. The prompt forbids new structures; every output still needs human review
(sea/tree hallucinations are the known failure mode in isometric.nyc and Malaga). Outputs are labelled
'model-assisted', never presented as survey data.
"""
import argparse, json, math, time
from pathlib import Path
from PIL import Image

PROMPT = ('Redraw the supplied orthographic city render as detailed high-bit pixel art. '
          'Preserve its camera, silhouettes, roads, courtyards, water boundaries and building positions. '
          'Use crisp pixel clusters, controlled flat shading, readable roofs and coherent sunlight. '
          'Keep sparse areas sparse. Add no unshown structures, monuments, roads or water. Render no labels or UI.')


def feather(size, overlap):
    """Alpha mask ramping in over `overlap` px on every side, so overlapping tiles blend without seams."""
    m = Image.new('L', (size, size), 255)
    px = m.load()
    for y in range(size):
        for x in range(size):
            d = min(x, y, size - 1 - x, size - 1 - y)
            if d < overlap:
                px[x, y] = int(255 * (d + 1) / (overlap + 1))
    return m


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('input'); ap.add_argument('--out', default='repainted.png')
    ap.add_argument('--model', default='Qwen/Qwen-Image-Edit'); ap.add_argument('--tile', type=int, default=1024)
    ap.add_argument('--overlap', type=int, default=192); ap.add_argument('--steps', type=int, default=30)
    ap.add_argument('--cfg', type=float, default=4.0); ap.add_argument('--seed', type=int, default=2031)
    ap.add_argument('--offload', action='store_true', help='CPU offload for 24 GB GPUs (slow)')
    a = ap.parse_args()
    import torch
    from diffusers import QwenImageEditPipeline
    pipe = QwenImageEditPipeline.from_pretrained(a.model, torch_dtype=torch.bfloat16)
    pipe.enable_model_cpu_offload() if a.offload else pipe.to('cuda')
    src = Image.open(a.input).convert('RGB')
    W, H, step = src.width, src.height, a.tile - a.overlap
    acc = Image.new('RGB', (W, H)); mask_full = feather(a.tile, a.overlap)
    xs = list(range(0, max(1, W - a.tile) + 1, step)); ys = list(range(0, max(1, H - a.tile) + 1, step))
    if xs[-1] + a.tile < W: xs.append(W - a.tile)
    if ys[-1] + a.tile < H: ys.append(H - a.tile)
    log = []
    for j, y in enumerate(ys):
        for i, x in enumerate(xs):
            t0 = time.time(); crop = src.crop((x, y, x + a.tile, y + a.tile))
            g = torch.Generator('cuda').manual_seed(a.seed + j * 1000 + i)
            out = pipe(image=crop, prompt=PROMPT, negative_prompt=' ', num_inference_steps=a.steps, true_cfg_scale=a.cfg, generator=g).images[0]
            out = out.resize((a.tile, a.tile), Image.LANCZOS)
            acc.paste(out, (x, y), mask_full if (i or j) else None)
            log.append({'tile': [x, y], 'seconds': round(time.time() - t0, 1)})
            print(f'tile {x},{y} {log[-1]["seconds"]}s', flush=True)
    acc.save(a.out)
    Path(a.out).with_suffix('.json').write_text(json.dumps({'model': a.model, 'prompt': PROMPT, 'seed': a.seed, 'steps': a.steps, 'cfg': a.cfg, 'tile': a.tile, 'overlap': a.overlap, 'tiles': log, 'note': 'model-assisted illustration; review before use'}, indent=1))


if __name__ == '__main__':
    main()
