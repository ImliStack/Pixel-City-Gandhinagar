#!/usr/bin/env python3
"""Offline, resource-gated Qwen edit crop benchmark. Never downloads weights."""
import argparse
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import resource
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[2]
GIB = 1024 ** 3
OFFICIAL_MODEL = 'Qwen/Qwen-Image-Edit'
OFFICIAL_REVISION = 'ac7f9318f633fc4b5778c59367c8128225f1e3de'
OFFICIAL_DOWNLOAD_BYTES = 57720467613
PROMPT = ('Redraw the supplied orthographic city render as detailed high-bit pixel art. '
          'Preserve its camera, silhouettes, roads, courtyards, water boundaries and building positions. '
          'Use crisp pixel clusters, controlled flat shading, readable roofs and coherent sunlight. '
          'Keep sparse areas sparse. Add no unshown structures, monuments, roads or water. Render no labels or UI.')


def command(args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=15).strip()
    except (OSError, subprocess.SubprocessError):
        return None


def hardware():
    ram = None
    if platform.system() == 'Darwin':
        n = command(['sysctl', '-n', 'hw.memsize'])
        ram = int(n) if n else None
    elif hasattr(os, 'sysconf'):
        ram = os.sysconf('SC_PAGE_SIZE') * os.sysconf('SC_PHYS_PAGES')
    if ram is None and importlib.util.find_spec('psutil'):
        import psutil
        ram = psutil.virtual_memory().total
    packages = {p: importlib.util.find_spec(p) is not None for p in
                ['torch', 'diffusers', 'transformers', 'accelerate', 'safetensors', 'PIL']}
    result = {'os': platform.platform(), 'architecture': platform.machine(),
              'python': platform.python_version(), 'python_executable': sys.executable,
              'ram_bytes': ram, 'disk_free_bytes': shutil.disk_usage(ROOT).free,
              'packages': packages, 'mps_available': None, 'cuda_available': None,
              'note': 'Apple Silicon uses unified memory; Metal support does not establish PyTorch MPS availability.'}
    if platform.system() == 'Darwin':
        result['cpu'] = command(['sysctl', '-n', 'machdep.cpu.brand_string'])
        result['metal_report'] = command(['system_profiler', 'SPDisplaysDataType'])
    if packages['torch']:
        try:
            import torch
            result.update(torch_version=torch.__version__,
                          mps_available=bool(torch.backends.mps.is_available()),
                          cuda_available=bool(torch.cuda.is_available()))
            if result['cuda_available']:
                result['cuda_device'] = torch.cuda.get_device_name(0)
                result['cuda_memory_bytes'] = torch.cuda.get_device_properties(0).total_memory
        except Exception as error:
            result['torch_probe_error'] = str(error)
    return result


def sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(4 * 1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def preflight(config):
    env = hardware()
    problems = []
    report = {'schema_version': 1, 'mode': 'B', 'status': 'blocked', 'generated_art': False,
              'hardware': env, 'official_candidate': {'model': OFFICIAL_MODEL,
              'revision': OFFICIAL_REVISION, 'license': 'Apache-2.0 (official model card)',
              'repository_bytes': OFFICIAL_DOWNLOAD_BYTES,
              'transformer_bf16_lower_bound_bytes': 20430401088 * 2},
              'network': 'disabled; local_files_only=True; no downloads',
              'implementation': 'Experimental single-crop editor; no joint-window denoising or city art generation.',
              'blockers': problems}
    if not config:
        problems.append('No configured local checkpoint. No model or adapter was downloaded or trained.')
    missing = [p for p, yes in env['packages'].items() if not yes]
    if missing:
        problems.append('Missing optional Python packages in this interpreter: ' + ', '.join(missing))
    budget = float((config or {}).get('memory_budget_gib', 4)) * GIB
    report['memory_budget_bytes'] = int(budget)
    if env['ram_bytes'] and budget > max(0, env['ram_bytes'] - 2 * GIB):
        problems.append('Requested memory budget leaves less than 2 GiB for the operating system.')
    if not config:
        if env['ram_bytes'] and 20430401088 * 2 > env['ram_bytes']:
            problems.append('Original Qwen-Image-Edit transformer BF16 weights alone exceed all physical memory; crop size does not fix weight residency.')
        return report
    report['configuration'] = {k: v for k, v in config.items() if k != 'prompt'}
    if config.get('model_id') != OFFICIAL_MODEL:
        problems.append('This provider implements only the inspected original Qwen/Qwen-Image-Edit API.')
    if config.get('revision') != OFFICIAL_REVISION:
        problems.append('This provider requires the exact inspected model revision; review other revisions before adding support.')
    if config.get('precision') not in ('float16', 'bfloat16', 'float32'):
        problems.append('Precision must be float16, bfloat16 or float32; quantized loaders are not implemented.')
    if config.get('adapter'):
        problems.append('Adapters are not implemented; no Jaipur LoRA with verified provenance exists in this project.')
    if env['ram_bytes'] is None:
        problems.append('Physical RAM could not be measured; checkpoint loading requires a measured memory limit.')
    if config.get('license') != 'Apache-2.0' or not config.get('license_verified_source'):
        problems.append('Record Apache-2.0 and the reviewed model-card/license source for the exact checkpoint.')
    size = int(config.get('crop_size', 512))
    steps = int(config.get('steps', 30))
    max_seconds = float(config.get('max_seconds', 900))
    if not math.isfinite(max_seconds) or not 30 <= max_seconds <= 3600:
        problems.append('Crop wall-time limit must be between 30 and 3600 seconds.')
    if not 512 <= size <= 1024 or size % 16:
        problems.append('Crop size must be a multiple of 16 between 512 and 1024.')
    if not 1 <= steps <= 50:
        problems.append('Pilot benchmark steps must be between 1 and 50.')
    checkpoint = Path(config.get('checkpoint', '/__no_checkpoint__')).expanduser()
    if not checkpoint.is_dir() or not (checkpoint / 'model_index.json').is_file():
        problems.append('Checkpoint must be an existing local Diffusers directory with model_index.json.')
    else:
        index = json.loads((checkpoint / 'model_index.json').read_text())
        if index.get('_class_name') != 'QwenImageEditPipeline':
            problems.append('Checkpoint pipeline is not the inspected QwenImageEditPipeline.')
        files = sorted(checkpoint.rglob('*.safetensors'))
        weights = sum(p.stat().st_size for p in files)
        report['checkpoint_weight_bytes'] = weights
        report['checkpoint_files'] = [{'path': str(p.relative_to(checkpoint)), 'bytes': p.stat().st_size} for p in files]
        # Conservative bound for unquantized original checkpoint: all weights plus crop activations.
        factor = 2 if config.get('precision') == 'float32' else 1
        estimated = max(weights * factor, 20430401088 * (4 if factor == 2 else 2)) + 3 * GIB
        report['estimated_minimum_process_bytes'] = estimated
        if not files:
            problems.append('Checkpoint contains no safetensors weights.')
        if estimated > budget:
            problems.append('Unquantized weights plus 3 GiB activation reserve exceed the configured memory budget.')
    device = config.get('device', 'mps' if env['architecture'] == 'arm64' and platform.system() == 'Darwin' else 'cpu')
    report['device'] = device
    if device not in ('cpu', 'mps', 'cuda'):
        problems.append('Device must be cpu, mps or cuda.')
    if device == 'mps' and not env['mps_available']:
        problems.append('PyTorch MPS is not available in this interpreter.')
    if device == 'cuda' and not env['cuda_available']:
        problems.append('CUDA is not available in this interpreter; CUDA is not a macOS backend.')
    if device == 'cuda' and env.get('cuda_memory_bytes') and report.get('estimated_minimum_process_bytes', 0) > env['cuda_memory_bytes'] - GIB:
        problems.append('The unquantized pipeline exceeds GPU memory after a 1 GiB reserve; this provider does not implement CPU offload.')
    if not problems:
        report['status'] = 'ready_for_experimental_crop'
    return report


def benchmark(config, report, source, output):
    # Offline environment is set before loading either model library.
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    import torch
    from PIL import Image
    from diffusers import QwenImageEditPipeline
    import signal
    def timeout(_signal, _frame):
        raise TimeoutError('Crop exceeded its configured wall-time limit; no completed artwork was accepted.')
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(int(config.get('max_seconds', 900)))
    size = int(config.get('crop_size', 512))
    with Image.open(source) as image:
        x, y = config.get('crop_origin', [(image.width-size)//2, (image.height-size)//2])
        if x < 0 or y < 0 or x + size > image.width or y + size > image.height:
            raise ValueError('Crop must fit wholly inside the supplied deterministic render.')
        crop = image.crop((x, y, x+size, y+size)).convert('RGB')
    report['input'] = {'path': str(source), 'sha256': sha256(source), 'crop': [x, y, size, size]}
    checkpoint = Path(config['checkpoint']).expanduser()
    report['weight_hashes'] = {str(p.relative_to(checkpoint)): sha256(p) for p in checkpoint.rglob('*.safetensors')}
    start = time.monotonic()
    dtype = getattr(torch, config['precision'])
    pipe = QwenImageEditPipeline.from_pretrained(str(checkpoint), torch_dtype=dtype,
                                                local_files_only=True, use_safetensors=True)
    pipe.to(report['device'])
    report['load_seconds'] = time.monotonic() - start
    if hasattr(pipe.vae, 'enable_slicing'):
        pipe.vae.enable_slicing()
    if report['device'] == 'cuda':
        torch.cuda.reset_peak_memory_stats()
    def check_resources(_pipe, _step, _timestep, callback_kwargs):
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        process_bytes = peak if platform.system() == 'Darwin' else peak * 1024
        if process_bytes > report['memory_budget_bytes']:
            raise MemoryError('Crop process exceeded its configured RSS budget.')
        return callback_kwargs
    start = time.monotonic()
    with torch.inference_mode():
        result = pipe(image=crop, prompt=config.get('prompt', PROMPT),
                      width=size, height=size, num_inference_steps=int(config.get('steps', 30)),
                      true_cfg_scale=float(config.get('true_cfg_scale', 4)), negative_prompt=' ',
                      callback_on_step_end=check_resources,
                      generator=torch.Generator(device='cpu').manual_seed(int(config.get('seed', 42)))).images[0]
    report['inference_seconds'] = time.monotonic() - start
    if result.size != (size, size):
        raise ValueError('Provider changed crop dimensions; output is rejected for geographic alignment.')
    output.parent.mkdir(parents=True, exist_ok=True)
    crop.save(output.with_name(output.stem + '-input.png'))
    result.save(output)
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    report.update(status='experimental_crop_generated_review_required', generated_art=True,
                  output={'path': str(output), 'sha256': sha256(output), 'bytes': output.stat().st_size},
                  peak_process_rss_bytes=peak if platform.system() == 'Darwin' else peak*1024,
                  geography_accepted=False, visual_review='pending; never auto-published to viewer')
    if report['device'] == 'cuda':
        report['peak_cuda_allocated_bytes'] = torch.cuda.max_memory_allocated()
    elif report['device'] == 'mps':
        report['mps_driver_allocated_bytes_after_crop'] = torch.mps.driver_allocated_memory()
    signal.alarm(0)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, help='Local checkpoint configuration JSON; see config.example.json')
    parser.add_argument('--input', type=Path, default=ROOT/'outputs/render/pilot.png')
    parser.add_argument('--output', type=Path, default=ROOT/'outputs/art-benchmark/crop.png')
    parser.add_argument('--report', type=Path, default=ROOT/'outputs/art-preflight.json')
    parser.add_argument('--execute', action='store_true', help='Actually run ONE crop only after successful preflight')
    parser.add_argument('--check', action='store_true', help='Report missing prerequisites with exit 0 for doctor automation')
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text()) if args.config else None
        report = preflight(config)
    except (OSError, ValueError, TypeError, AttributeError) as error:
        config = None
        report = {'schema_version': 1, 'mode': 'B', 'status': 'blocked', 'generated_art': False,
                  'blockers': ['Invalid local configuration: ' + str(error)]}
    if args.execute and not report['blockers']:
        try:
            if not args.input.is_file():
                raise ValueError('Input deterministic render does not exist: ' + str(args.input))
            benchmark(config, report, args.input, args.output)
        except Exception as error:
            report.update(status='failed', error=str(error), generated_art=False)
        finally:
            import signal
            signal.alarm(0)
    elif args.execute:
        report['execution'] = 'refused_by_preflight'
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    return 0 if args.check or not report['blockers'] and report['status'] != 'failed' else 2


if __name__ == '__main__':
    sys.exit(main())
