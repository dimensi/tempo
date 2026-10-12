import importlib.machinery, importlib.util, io, os, pathlib, subprocess, sys, tarfile, tempfile, time
BASE=pathlib.Path(__file__).resolve().parent
loader=importlib.machinery.SourceFileLoader("candidate",str(BASE/"nutrition-cd.py.candidate"));spec=importlib.util.spec_from_loader(loader.name,loader);m=importlib.util.module_from_spec(spec);loader.exec_module(m)
def archive(kind=tarfile.REGTYPE):
    b=io.BytesIO()
    with tarfile.open(fileobj=b,mode="w",format=tarfile.USTAR_FORMAT) as t:
        for name in ("manifest.json","image.tar.gz"):
            h=tarfile.TarInfo(name);h.type=kind;h.size=1 if kind==tarfile.REGTYPE else 0;t.addfile(h,io.BytesIO(b"x") if h.size else None)
    return b.getvalue()
def rejects(data):
    with tempfile.TemporaryDirectory() as d:
        try:m.receive(io.BytesIO(data),pathlib.Path(d))
        except (ValueError,UnicodeDecodeError):return
        raise AssertionError("Malicious tar accepted")
with tempfile.TemporaryDirectory() as d:m.receive(io.BytesIO(archive()),pathlib.Path(d))
for kind in (tarfile.XHDTYPE,tarfile.XGLTYPE,tarfile.GNUTYPE_LONGNAME,tarfile.GNUTYPE_LONGLINK,tarfile.SYMTYPE):
    h=tarfile.TarInfo("manifest.json");h.type=kind;h.size=m.MAX_ARCHIVE;rejects(h.tobuf(format=tarfile.USTAR_FORMAT))
b=bytearray(archive());b[10]^=1;rejects(bytes(b));rejects(archive()+b"x");rejects(archive()+b"\0"*40000)
h=tarfile.TarInfo("image.tar.gz");h.size=m.MAX_ARCHIVE+1;rejects(h.tobuf(format=tarfile.USTAR_FORMAT))
r,w=os.pipe()
try:
    with os.fdopen(r,"rb",buffering=0) as stream:
        started=time.monotonic()
        try:m.BoundedReader(stream,0.02).exact(512)
        except ValueError:pass
        else:raise AssertionError("Deadline absent")
        assert time.monotonic()-started<0.5
finally:os.close(w)
reader=m.BoundedReader(io.BytesIO(b"abc"));reader.remaining=1
try:reader.exact(2)
except ValueError:pass
else:raise AssertionError("Total stream limit absent")
print("PASS: USTAR success; PAX/GNU/link/oversize/checksum/trailing/total-limit/real-pipe deadline guards")
NEW="a"*40;OLD="b"*40
mock=r'''import os,pathlib,sys
args=sys.argv[1:];mode=os.environ["MODE"];root=pathlib.Path.cwd();log=root/"commands.log"
def record(s):
 with log.open("a") as f:f.write(s+"\n")
def env(key):
 return dict(line.split("=",1) for line in (root/"runtime.env").read_text().splitlines())[key]
if args[0]=="image":print("a"*40);sys.exit(0)
if args[0]=="inspect":
 field=args[-1];image=env("NUTRITION_IMAGE");revision=env("DEPLOYED_COMMIT")
 if "Health.Status" in field:
  failed=(revision=="a"*40 and mode in ("health","rollback-health")) or (revision=="b"*40 and mode=="rollback-health" and (root/"up-count").exists())
  record("HEALTH "+revision);print("unhealthy" if failed else "healthy")
 elif "Config.Image" in field:print(image)
 else:print(revision)
 sys.exit(0)
if "stop" in args:record("STOP")
elif "run" in args:
 prefix=next((a.split("=",1)[1] for a in args if a.startswith("BACKUP_PREFIX=")),"")
 record(("RESTORE " if "fs.rmSync" in args[-1] else "SNAPSHOT ")+prefix)
elif "ps" in args:
 if mode=="ps" and env("DEPLOYED_COMMIT")=="a"*40 and not (root/"ps-failed").exists():
  (root/"ps-failed").touch();record("PS_FAIL");sys.exit(1)
 print("container")
elif "up" in args:
 record("UP "+env("DEPLOYED_COMMIT"));(root/"up-count").touch()
else:record("OTHER")
'''
for mode in ("rewrite","ps","health","rollback-health","success"):
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d);bindir=root/"bin";bindir.mkdir()
  (root/"runtime.env").write_text("DEPLOYED_COMMIT="+OLD+"\nNUTRITION_IMAGE=nutrition-release:"+OLD[:12]+"\n")
  (bindir/"docker").write_text("#!"+sys.executable+"\n"+mock)
  (bindir/"curl").write_text("#!/bin/sh\nprintf 200\n")
  (bindir/"sleep").write_text("#!/bin/sh\nexit 0\n")
  (bindir/"python3").write_text("#!/bin/sh\n"+("exit 1\n" if mode=="rewrite" else "exec "+sys.executable+" \"$@\"\n"))
  for f in bindir.iterdir():f.chmod(0o700)
  script=(BASE/"upgrade-ci-release.sh.candidate").read_text().replace("cd /opt/compose/yazio-dashboard","cd "+str(root))
  run=subprocess.run(["bash","-c",script,"test",NEW],env=os.environ|dict(PATH=str(bindir)+":"+os.environ["PATH"],MODE=mode,CD_BACKUP_STAMP="20261012T120000Z-1"),capture_output=True,text=True,timeout=10)
  log=(root/"commands.log").read_text()
  if mode=="success":assert run.returncode==0 and "RESTORE" not in log
  else:
   assert run.returncode!=0
   assert "UP "+OLD in log
   assert log.index("SNAPSHOT failed-before-rollback")<log.index("RESTORE pre-upgrade")
   if mode=="rollback-health":assert "ATTENTION" in run.stderr
   else:assert "previous exact healthy release restored" in run.stderr
print("PASS: injected env rewrite/compose-ps/new-health failures recover old exact healthy image; rollback-health failure alerts; success disarms trap")
