"""Exercise the real installer shell with disposable files and command faults."""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

BASE = pathlib.Path(__file__).resolve().parent
MOCK = r'''
import os,pathlib,shutil,subprocess,sys
name=pathlib.Path(sys.argv[0]).name;args=sys.argv[1:]
root=pathlib.Path(os.environ['FIXTURE']);mode=os.environ['FAULT']
def once(label):
 p=root/label
 if p.exists():return False
 p.touch();return True
if name=='stat':
 print('0' if args[1]=='%u' else '700');sys.exit(0)
if name=='flock':sys.exit(0)
if name=='docker':
 assert not any(x in args for x in ('up','down','stop','run','load')), 'Installer changed running service'
 if 'config' in args:sys.exit(1 if mode in ('config','restore') else 0)
 print('healthy' if 'inspect' in args else 'synthetic-container');sys.exit(0)
if name=='install':
 if mode=='install' and args[-1].endswith('nutrition-runtime-config.py.runtime-channel-new'):sys.exit(1)
 shutil.copyfile(args[-2],args[-1]);os.chmod(args[-1],int(args[args.index('-m')+1],8));sys.exit(0)
if name=='mv' and mode=='rename' and once('rename-failed'):sys.exit(1)
if name=='cp' and mode=='restore' and '/runtime-channel-install.' in args[-2] and args[-2].endswith('/0'):sys.exit(1)
os.execv('/bin/'+name,[name,*args])
'''
for fault in ('success', 'install', 'rename', 'config', 'restore'):
    with tempfile.TemporaryDirectory() as directory:
        root = pathlib.Path(directory)
        bundle = root / 'bundle'; bundle.mkdir()
        project = root / 'project'; (project / 'verification').mkdir(parents=True)
        libexec = root / 'libexec'; libexec.mkdir()
        binary = root / 'bin'; binary.mkdir()
        names = ['nutrition-cd', 'nutrition-upgrade-ci-release', 'nutrition-runtime-config.py', 'compose.yaml', 'compose.home.yaml']
        sources = ['nutrition-cd.py.candidate', 'upgrade-ci-release.sh.candidate', 'nutrition-runtime-config.py', 'compose.yaml', 'compose.home.yaml']
        targets = [libexec / name for name in names[:3]] + [project / name for name in names[3:]]
        for source in sources:
            (bundle / source).write_text('reviewed synthetic ' + source)
        for target in targets:
            target.write_text('original ' + target.name)
        (project / 'runtime.env').write_bytes(b'BETTER_AUTH_SECRET=synthetic-original\n')
        (project / 'release.env').write_text('synthetic release metadata\n')
        for name in ('stat', 'flock', 'docker', 'install', 'mv', 'cp'):
            path = binary / name; path.write_text('#!' + sys.executable + '\n' + MOCK); path.chmod(0o700)
        script = (BASE / 'install-runtime-channel.sh').read_text().replace('"$EUID" == 0', '"$EUID" == ' + str(os.geteuid()))
        script = script.replace('/opt/compose/yazio-dashboard', str(project)).replace('/usr/local/libexec', str(libexec))
        installer = bundle / 'install-runtime-channel.sh'; installer.write_text(script)
        result = subprocess.run(['bash', str(installer)], env=os.environ | {'PATH': str(binary) + ':' + os.environ['PATH'], 'FAULT': fault, 'FIXTURE': str(root)}, capture_output=True, text=True, timeout=20)
        assert (project / 'runtime.env').read_bytes() == b'BETTER_AUTH_SECRET=synthetic-original\n'
        assert 'synthetic-original' not in result.stdout + result.stderr
        assert not list(root.rglob('*.runtime-channel-new'))
        if fault == 'success':
            assert result.returncode == 0, result.stderr
            assert all(target.read_text().startswith('reviewed synthetic ') for target in targets)
        elif fault == 'restore':
            assert result.returncode != 0 and 'ATTENTION' in result.stderr, result.stderr
            assert all(target.read_text() == 'original ' + target.name for target in targets[1:])
        else:
            assert result.returncode != 0 and 'previous files restored' in result.stderr, result.stderr
            assert all(target.read_text() == 'original ' + target.name for target in targets)
print('PASS: installer success/install/rename/config/restore faults; auth bytes and running service preserved')
