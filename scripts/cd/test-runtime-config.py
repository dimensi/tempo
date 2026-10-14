"""Synthetic-only config, transaction, failure and Compose dotenv tests."""
import importlib.util
import importlib.machinery
import io
import json
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch

BASE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('runtime', BASE / 'nutrition-runtime-config.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
VALUES = m.FIXED | {key: 'synthetic-$#"-secret' for key in m.KEYS if key not in m.FIXED}
loader = importlib.machinery.SourceFileLoader('receiver', str(BASE / 'nutrition-cd.py.candidate'))
receiver_spec = importlib.util.spec_from_loader(loader.name, loader)
receiver = importlib.util.module_from_spec(receiver_spec)
loader.exec_module(receiver)


def payload(values=None):
    return json.dumps({'version': 2, 'runtime': VALUES if values is None else values}).encode()


class ConfigTests(unittest.TestCase):
    def test_receive_failure_removes_even_partial_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            stage = pathlib.Path(directory)
            def failed_receive(*args):
                (stage / 'runtime-config.json').write_bytes(b'partial synthetic secret')
                (stage / 'image.tar.gz').write_bytes(b'image diagnostics')
                raise receiver.ProtocolError('truncated-stream', 24)
            diagnostics = io.StringIO()
            with patch.object(receiver, 'receive', side_effect=failed_receive), patch.object(receiver.sys, 'stderr', diagnostics), self.assertRaises(ValueError):
                receiver.deploy(stage, '1', 'a' * 40, 'b' * 40, 'c' * 64, stage / 'receipt')
            self.assertFalse((stage / 'runtime-config.json').exists())
            self.assertTrue((stage / 'image.tar.gz').exists())
            self.assertNotIn('synthetic secret', diagnostics.getvalue())
            self.assertIn('protocol=truncated-stream receivedBytes=24', diagnostics.getvalue())

    def test_schema_and_injection(self):
        self.assertEqual(m.validate(payload()), VALUES)
        invalid = [b'{}', b'{"version":2,"version":2,"runtime":{}}', b'[]', b'x' * 16385]
        for value in ('', 'x\ny', 'x\ry', 'x\0y', "x'y", 'x\\y', 'é', 'x' * 2049, 123, True):
            invalid.append(payload(VALUES | {'ANAMNESIS_LLM_API_KEY': value}))
        for key in m.FIXED:
            invalid.append(payload(VALUES | {key: 'unapproved'}))
        invalid += [payload(VALUES | {'BETTER_AUTH_SECRET': 'forbidden'}), payload({})]
        for data in invalid:
            with self.subTest(data=data[:40]), self.assertRaises((ValueError, TypeError)):
                m.validate(data)

    def test_auth_and_unrelated_bytes(self):
        original = b'# preserve\r\nBETTER_AUTH_SECRET="synthetic-auth$#"\r\nOTHER=untouched\r\n'
        updated = m.updated(original, VALUES)
        self.assertTrue(updated.startswith(original))
        self.assertEqual(m.updated(updated, VALUES), updated)
        for original in (b'S3_BUCKET=a\nS3_BUCKET=b\n', b"AUTH='multiline\nS3_BUCKET=auth-fragment\n'\n"):
            with self.assertRaises(ValueError):
                m.updated(original, VALUES)

    def test_transaction_and_faults(self):
        for fault in ('none', 'backup-fsync', 'partial-write', 'replace'):
            with self.subTest(fault=fault), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                source = root / 'verification/ci-incoming/stage/runtime-config.json'
                source.parent.mkdir(parents=True, mode=0o700)
                source.write_bytes(payload()); source.chmod(0o600)
                runtime = root / 'runtime.env'
                original = b'BETTER_AUTH_SECRET=synthetic-original\nOTHER=unchanged\n'
                runtime.write_bytes(original); runtime.chmod(0o600)
                stamp = '20261014T120000Z-1'
                with patch.object(m, 'PROJECT', root):
                    self.assertTrue(m.needs_inventory(source))
                    if fault == 'none':
                        m.apply(stamp, source)
                        self.assertFalse(m.needs_inventory(source))
                        self.assertTrue(runtime.read_bytes().startswith(original))
                    else:
                        target = 'replace' if fault == 'replace' else 'fsync'
                        def fail(*args):
                            if fault == 'partial-write':
                                # Simulate a short disk write before its failed fsync.
                                os.ftruncate(args[0], 5)
                            raise OSError('synthetic injected failure')
                        with patch.object(m.os, target, side_effect=fail), self.assertRaises(OSError):
                            m.apply(stamp, source)
                    m.restore(stamp)
                    self.assertEqual(runtime.read_bytes(), original)
                    self.assertEqual(runtime.stat().st_mode & 0o777, 0o600)
                    self.assertFalse(list(root.rglob('.runtime-backup.*')))
                    self.assertFalse(list(root.glob('.runtime.env.*')))

    def test_actual_compose_literal_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            runtime = root / 'runtime.env'
            runtime.write_bytes(m.updated(b'', VALUES))
            compose = root / 'compose.yaml'
            compose.write_text('services:\n  app:\n    image: synthetic:unused\n    environment:\n' + ''.join('      ' + key + ': ${' + key + '}\n' for key in m.KEYS))
            result = subprocess.run(['docker', 'compose', '--env-file', str(runtime), '-f', str(compose), 'config', '--format', 'json'], capture_output=True, text=True, check=True)
            # Compose's rendered model escapes dollars for a subsequent parse.
            self.assertEqual(json.loads(result.stdout)['services']['app']['environment'], {key: value.replace('$', '$$') for key, value in VALUES.items()})
            resolved = subprocess.run(['docker', 'compose', '--env-file', str(runtime), '-f', str(compose), 'config', '--environment'], capture_output=True, text=True, check=True)
            environment = dict(line.split('=', 1) for line in resolved.stdout.splitlines())
            self.assertEqual({key: environment[key] for key in m.KEYS}, VALUES)


if __name__ == '__main__':
    unittest.main()
