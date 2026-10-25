"""Guard against unintended model loading on the bounded pilot machine."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import stylize


class ArtPreflightTests(unittest.TestCase):
    def setUp(self):
        self.env = {'ram_bytes': 8*stylize.GIB, 'architecture': 'arm64',
                    'packages': {p: True for p in ['torch', 'diffusers', 'transformers', 'accelerate', 'safetensors', 'PIL']},
                    'mps_available': True, 'cuda_available': False}
        self.config = json.loads((Path(__file__).parent/'config.example.json').read_text())

    def test_unconfigured_is_honest_and_blocked(self):
        with patch.object(stylize, 'hardware', return_value=self.env):
            report = stylize.preflight(None)
        self.assertFalse(report['generated_art'])
        self.assertEqual(report['status'], 'blocked')
        self.assertTrue(any('physical memory' in reason for reason in report['blockers']))

    def test_tiny_or_truncated_weights_cannot_evade_model_memory_floor(self):
        with tempfile.TemporaryDirectory() as directory:
            checkpoint = Path(directory)
            (checkpoint/'model_index.json').write_text('{"_class_name":"QwenImageEditPipeline"}')
            (checkpoint/'model.safetensors').write_bytes(b'x')
            self.config['checkpoint'] = directory
            with patch.object(stylize, 'hardware', return_value=self.env):
                report = stylize.preflight(self.config)
        self.assertGreater(report['estimated_minimum_process_bytes'], 8*stylize.GIB)
        self.assertTrue(any('exceed the configured memory budget' in reason for reason in report['blockers']))

    def test_unreviewed_revision_and_unbounded_crop_are_rejected(self):
        self.config.update(revision='main', crop_size=8192, steps=5000, max_seconds=999999)
        with patch.object(stylize, 'hardware', return_value=self.env):
            report = stylize.preflight(self.config)
        joined = '\n'.join(report['blockers'])
        for phrase in ['exact inspected model revision', 'Crop size', 'steps', 'wall-time']:
            self.assertIn(phrase, joined)

    def test_execute_with_missing_model_writes_report_but_no_art(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory)/'report.json'
            image = Path(directory)/'should-not-exist.png'
            result = subprocess.run([sys.executable, str(Path(stylize.__file__)), '--execute',
                                     '--report', str(report), '--output', str(image)],
                                    capture_output=True, text=True, timeout=45)
            self.assertEqual(result.returncode, 2)
            data = json.loads(report.read_text())
            self.assertEqual(data['execution'], 'refused_by_preflight')
            self.assertFalse(data['generated_art'])
            self.assertFalse(image.exists())


if __name__ == '__main__':
    unittest.main()
