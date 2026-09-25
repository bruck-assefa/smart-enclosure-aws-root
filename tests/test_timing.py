import copy
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sync_timing', ROOT / 'tools/sync_timing.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)


class TimingTests(unittest.TestCase):
    def setUp(self):
        self.document = json.loads(sync.SOURCE.read_text())

    def test_invalid_durations_rejected(self):
        for value in [0, -1, True, '5', float('nan'), float('inf')]:
            with self.subTest(value=value):
                document = copy.deepcopy(self.document)
                document['settings']['sensor_read_interval']['seconds'] = value
                with self.assertRaises(ValueError):
                    sync.validate(document)

    def test_missing_and_misspelled_keys_rejected(self):
        del self.document['settings']['sensor_read_timeout']
        with self.assertRaises(ValueError):
            sync.validate(self.document)

    def test_freshness_conflict_rejected(self):
        self.document['settings']['browser_state_poll_interval']['seconds'] = 20
        with self.assertRaises(ValueError):
            sync.validate(self.document)

    def test_changed_value_reaches_both_python_outputs_and_javascript(self):
        self.document['settings']['sensor_read_interval']['seconds'] = 2.25
        outputs = sync.outputs(sync.validate(self.document), ROOT.parent / 'backend')
        for path, content in outputs.items():
            if path.suffix == '.py':
                namespace = {}
                exec(content, namespace)
                self.assertEqual(namespace['SENSOR_READ_INTERVAL'], 2.25)
            else:
                self.assertIn('"sensor_read_interval": 2.25', content)
