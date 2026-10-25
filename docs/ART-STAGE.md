# Local art stage status

**Mode A is deterministic geometry artwork. Mode B has not been generated.** The available Apple M3 has 8 GiB of unified RAM and Metal support. System Python 3.9.6 has no PyTorch, Diffusers, Transformers, Accelerate or Safetensors installation, and the standard Hugging Face/Torch cache directories contain no model. Metal hardware support alone is not evidence that a PyTorch MPS pipeline works.

The inspected official candidate is `Qwen/Qwen-Image-Edit` at revision `ac7f9318f633fc4b5778c59367c8128225f1e3de`. Its [model card](https://huggingface.co/Qwen/Qwen-Image-Edit/blob/ac7f9318f633fc4b5778c59367c8128225f1e3de/README.md) declares Apache-2.0, image conditioning through Qwen2.5-VL and the VAE, and the `QwenImageEditPipeline` API. Its official example uses CUDA/BF16; that is not a validated macOS configuration. The checkpoint's model index identifies the transformer, text encoder, scheduler, tokenizer/processor and VAE dependencies.

Metadata was fetched without model weights. Repository files total **57,720,467,613 bytes (~53.76 GiB)** at the inspected revision. The transformer metadata alone lists **20,430,401,088 BF16 parameters**, a **40,860,802,176-byte (~38.05 GiB)** weight lower bound before text encoder, VAE, activations or operating system. A 512 px crop reduces activations, not this model-weight requirement. The current machine cannot hold this unquantized candidate within a safe local memory budget. There is no tested alternative checkpoint or Jaipur adapter here; no LoRA has been trained. No CUDA package or large model was installed.

## Commands that exist

```sh
# Reads hardware/packages and writes outputs/art-preflight.json.
# Returns 2 when prerequisites are missing; creates no art image.
npm run stylize-pilot

# Same report with exit 0 for an automated doctor check.
npm run stylize-pilot -- --check

# Check a user-prepared LOCAL checkpoint; no network download occurs.
python3 tools/stylize/stylize.py --config tools/stylize/config.example.json --check

# On a suitable local machine, after preparing the optional environment,
# edit a COPY of the example config with its real checkpoint and budget.
# Run exactly one crop from the actual deterministic image.
python3 tools/stylize/stylize.py --config /path/to/local-model.json \
  --input outputs/render/pilot.png --execute
```

The default 4 GiB process budget intentionally prevents the example from loading the 54 GiB checkpoint. It is not a suggestion that setting the number higher creates available memory. The guard reserves 2 GiB for the OS and rejects an unquantized weight estimate plus 3 GiB crop-activation reserve if it exceeds the process budget. A suitable larger-memory machine needs the optional packages installed in a separate environment: `torch`, `diffusers` with `QwenImageEditPipeline`, `transformers`, `accelerate`, `safetensors`, and Pillow. Verify their compatible versions and the model card when that machine is prepared; no untested dependency lock is presented as a working ML environment.

The optional provider accepts only an already-existing Diffusers checkpoint directory at the inspected revision, license source, precision, seed and 512–1024 px crop. It rejects quantization/adapters because those loaders have not been validated. It forces Hugging Face offline mode and `local_files_only=True`. A configurable 15-minute default wall-time alarm covers loading and inference; each completed denoising step checks process RSS. The static preflight is the primary memory guard: these checks are not a hard OS allocation cap and cannot guarantee interruption during every native operation. It hashes the source and checkpoint weights, records load/inference duration, process peak RSS and available backend allocation counters, and saves the input crop beside the experimental output. Errors are written to the JSON report. A crop is never automatically published to the viewer. The execution path is implemented but could not be hardware-tested here; only safe refusal/preflight is tested on this machine.

## What remains before polished mode B

1. Prepare a locally runnable, appropriately licensed edit model on sufficient local hardware. A smaller/quantized provider requires its own API, conditioning, license and memory validation; it cannot simply bypass this provider's guard.
2. Benchmark one 512 px crop, then 1024 px if memory allows. Review landmark silhouettes, roads, courts, mapped water and empty areas against source render and masks. Record real time/RAM rather than borrowing the London/NYC authors' figures.
3. If the model cannot preserve Jaipur geometry and the desired drawing style, obtain authorised target art for training pairs. Keep geographic train/validation areas distinct. Record adapter provenance and exact training recipe; an NYC adapter is not evidence for Jaipur.
4. Implement model-specific joint-window denoising with shared noise/positions, per-step weighted predictions and pinned completed overlaps in bounded resumable blocks. The original MultiDiffusion implementation does not directly support this Qwen transformer. This repository currently implements **only an experimental single-crop edit**, not joint generation or guaranteed tile continuity.
5. Test both block overlap and decoder rims. Review contact sheets of roads, foliage, landmarks, sparse areas and failed crops alongside masks. A seam metric or feathered independent tile edit is insufficient to establish continuity.
6. Export an accepted art pyramid with a distinct version only after structural and visual review. Then enable the viewer's art comparison against the deterministic source.

No per-block generation time or full-city art budget is claimed because no inference was run. Deterministic rendering and DZI delivery have their own measured benchmarks; they are not estimates for an image model. The polished high-bit target remains incomplete on this hardware.
