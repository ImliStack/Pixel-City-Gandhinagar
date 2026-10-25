#!/usr/bin/env python3
"""Read-only machine assessment. No model or data downloads."""
import json, os, platform, shutil, subprocess, sys
from pathlib import Path

def run(args):
    try:
        p = subprocess.run(args, capture_output=True, text=True, timeout=20)
        return p.stdout.strip() or p.stderr.strip()
    except Exception as e:
        return str(e)

config=json.loads(Path('config/pilot.json').read_text())
report = {'os': platform.platform(), 'architecture': platform.machine(), 'python': sys.version.split()[0],
          'node': run(['node', '--version']), 'freeDiskGiB': round(shutil.disk_usage('.').free / 2**30, 2),
          'limits': {'pilotWidth': config['width'], 'maxOutputPixels': config['maxOutputPixels'], 'renderChunkPixels': config['chunkSize'],
                     'maxDataDownloadMiB': 12, 'modelDownloads': 'disabled by default'}}
if platform.system() == 'Darwin':
    raw = run(['system_profiler', 'SPHardwareDataType', 'SPDisplaysDataType', '-json'])
    try:
        info = json.loads(raw)
        hw = info.get('SPHardwareDataType', [{}])[0]
        report['hardware'] = {k: v for k, v in hw.items() if k in ('chip_type', 'physical_memory', 'number_processors', 'machine_name')}
        report['graphics'] = [{k:v for k,v in gpu.items() if k in ('sppci_model', 'sppci_cores', 'spdisplays_metal', 'spdisplays_vendor')} for gpu in info.get('SPDisplaysDataType', [])]
    except ValueError:
        report['hardware'] = 'system_profiler unavailable'
    report['cuda'] = 'Not applicable on macOS; never installed'
else:
    report['nvidia'] = run(['nvidia-smi', '--query-gpu=name,memory.total,memory.free', '--format=csv']) if shutil.which('nvidia-smi') else 'No nvidia-smi'
try:
    import torch
    report['torch'] = {'version': torch.__version__, 'mpsBuilt': torch.backends.mps.is_built(), 'mpsAvailable': torch.backends.mps.is_available()}
except ImportError:
    report['torch'] = 'Not installed; Metal hardware support does not establish PyTorch MPS availability'
Path('outputs').mkdir(exist_ok=True)
Path('outputs/doctor.json').write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
