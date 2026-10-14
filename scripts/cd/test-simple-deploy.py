"""Execute the actual inline workflow code with synthetic values and command faults."""
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / '.github/workflows/cd.yml').read_text()
ENV = textwrap.dedent(WORKFLOW.split("<<'PYENV'\n")[1].split('\n          PYENV')[0])
REMOTE = textwrap.dedent(WORKFLOW.split("<<'REMOTE'\n")[1].split('\n          REMOTE')[0])
REVISION = 'a' * 40
VALUES = dict(S3_ENDPOINT='http://192.168.1.90:8333', S3_REGION='us-east-1', S3_BUCKET='apps',
              ANAMNESIS_LLM_BASE_URL='https://api.z.ai/api/coding/paas/v4', ANAMNESIS_LLM_MODEL='glm-5.3-flash',
              ANAMNESIS_LLM_TIMEOUT_MS='120000', ENABLE_ANAMNESIS_WORKER='false',
              S3_ACCESS_KEY_ID='synthetic-$#"-key', S3_SECRET_ACCESS_KEY='synthetic-$#"-secret', ANAMNESIS_LLM_API_KEY='synthetic-$#"-llm')
MOCK = r'''
import os,pathlib,sys
a=sys.argv[1:];mode=os.environ['MODE'];root=pathlib.Path(os.environ['FIXTURE'])
assert not any('synthetic-' in value for value in a), 'Secret in argv'
def log(value):
 with (root/'commands').open('a') as f:f.write(value+'\n')
if a[0]=='login':
 assert sys.stdin.read()=='synthetic-token'
 assert os.environ['DOCKER_CONFIG'].startswith(str(root/'project/.deploy-'))
 log('LOGIN');sys.exit(1 if mode=='login' else 0)
if a[0]=='ps':print('old');sys.exit(0)
if a[0]=='image':print('a'*40 if mode!='identity' else 'b'*40);sys.exit(0)
if a[0]=='inspect':
 if a[1]=='old':print('nutrition-release:old')
 elif 'Config.Image' in a[-1]:print('ghcr.io/dimensi/yazio-dashboard:'+'a'*40)
 else:print('a'*40)
 sys.exit(0)
if a[0]=='run':
 assert a[a.index('--volumes-from')+1]=='old:ro' and a[a.index('--network')+1]=='none'
 log('INVENTORY');sys.exit(1 if mode in ('inventory','restart') else 0)
if a[0] in ('stop','start','exec'):
 log(a[0].upper());sys.exit(1 if a[0]=='start' and mode=='restart' else 0)
assert a[0]=='compose'
assert a[a.index('-p')+1]=='nutrition'
assert '--env-file' in a and 'runtime.env' in a
assert 'down' not in a and 'rm' not in a
if 'config' in a:log('CONFIG');sys.exit(1 if mode=='config' else 0)
if 'pull' in a:log('PULL');sys.exit(1 if mode=='pull' else 0)
if 'up' in a:log('UP');sys.exit(1 if mode=='up' else 0)
if 'ps' in a:print('new');sys.exit(0)
raise AssertionError(a)
'''


def generate(path, overrides=None):
    environment = os.environ | VALUES | dict(DEPLOY_ENV_PATH=str(path), GITHUB_REPOSITORY='dimensi/yazio-dashboard', REVISION=REVISION) | (overrides or {})
    return subprocess.run([sys.executable, '-c', ENV], env=environment, capture_output=True, text=True)


class DeployTests(unittest.TestCase):
    def test_env_validation_and_literal_compose_values(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            path = root / '.env.deploy'
            self.assertEqual(generate(path).returncode, 0)
            auth = root / 'runtime.env'; auth.write_text('BETTER_AUTH_SECRET=synthetic-auth-unchanged\n')
            result = subprocess.run(['docker', 'compose', '--env-file', str(auth), '--env-file', str(path), '-f', str(ROOT / 'compose.yaml'), '-f', str(ROOT / 'compose.home.yaml'), 'config', '--environment'], check=True, capture_output=True, text=True)
            values = dict(line.split('=', 1) for line in result.stdout.splitlines())
            self.assertEqual({key: values[key] for key in VALUES}, VALUES)
            self.assertEqual(values['BETTER_AUTH_SECRET'], 'synthetic-auth-unchanged')
            self.assertNotIn('BETTER_AUTH_SECRET', path.read_text())
            for key, value in [('ANAMNESIS_LLM_MODEL', 'paid-fallback'), ('ENABLE_ANAMNESIS_WORKER', 'true'), ('S3_SECRET_ACCESS_KEY', 'bad\nvalue'), ('ANAMNESIS_LLM_API_KEY', "bad'quote"), ('S3_SECRET_ACCESS_KEY', 'bad\\escape')]:
                path.unlink(missing_ok=True)
                result = generate(path, {key: value})
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse(path.exists())

    def test_actual_remote_shell_failures(self):
        for mode in ('success', 'login', 'config', 'pull', 'identity', 'inventory', 'restart', 'copy', 'rename', 'up', 'health'):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory); project = root / 'project'; project.mkdir()
                (project / 'verification').mkdir()
                stage = project / ('.deploy-1-1-' + REVISION); stage.mkdir(mode=0o700)
                self.assertEqual(generate(stage / '.env.deploy').returncode, 0)
                (stage / 'registry-token').write_text('synthetic-token')
                for name in ('compose.yaml', 'compose.home.yaml'):
                    (stage / name).write_bytes((ROOT / name).read_bytes())
                    (project / name).write_text('previous compose\n')
                auth = b'BETTER_AUTH_SECRET=synthetic-auth-unchanged\nOTHER=preserve\n'
                (project / 'runtime.env').write_bytes(auth)
                (project / 'release.env').write_bytes(b'previous metadata\n')
                binary = root / 'bin'; binary.mkdir()
                (binary / 'docker').write_text('#!' + sys.executable + '\n' + MOCK)
                (binary / 'curl').write_text('#!/bin/sh\nprintf ' + ('503' if mode == 'health' else '200') + '\n')
                (binary / 'flock').write_text('#!/bin/sh\nexit 0\n')
                for command, fault in [('cp', 'copy'), ('mv', 'rename')]:
                    (binary / command).write_text('#!/bin/sh\nif [ "$MODE" = '+fault+' ]; then\n for argument in "$@"; do\n if [ "$argument" = .env.deploy.new ]; then exit 1; fi\n done\nfi\nexec /bin/'+command+' "$@"\n')
                for file in binary.iterdir(): file.chmod(0o700)
                script = REMOTE.replace('/opt/compose/yazio-dashboard', str(project))
                result = subprocess.run(['bash', '-c', script, 'test', REVISION, '1-1', 'actor'], env=os.environ | dict(PATH=str(binary) + ':' + os.environ['PATH'], MODE=mode, FIXTURE=str(root)), capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode == 0, mode == 'success', result.stderr)
                self.assertEqual((project / 'runtime.env').read_bytes(), auth)
                self.assertEqual((project / 'release.env').read_bytes(), b'previous metadata\n')
                self.assertFalse(stage.exists())
                self.assertFalse(list(project.glob('*.new')))
                self.assertFalse((project / '.env.deploy.new').exists())
                self.assertNotIn('synthetic-token', result.stdout + result.stderr)
                self.assertNotIn('synthetic-$#', result.stdout + result.stderr)
                log = (root / 'commands').read_text()
                if mode == 'inventory':
                    self.assertIn('STOP\nINVENTORY\nSTART', log)
                    self.assertNotIn('UP', log)
                    self.assertEqual((project / 'compose.yaml').read_text(), 'previous compose\n')
                if mode == 'restart':
                    self.assertIn('ATTENTION: old app restart failed', result.stderr)
                if mode in ('login', 'config', 'pull', 'identity'):
                    self.assertNotIn('STOP', log)
                    self.assertNotIn('UP', log)
                if mode == 'success':
                    self.assertLess(log.index('PULL'), log.index('STOP'))
                    self.assertLess(log.index('EXEC'), log.index('UP'))
                if mode in ('up', 'health'):
                    self.assertNotIn('START', log)  # No blind restart/DB restore after migrations.


if __name__ == '__main__':
    unittest.main()
