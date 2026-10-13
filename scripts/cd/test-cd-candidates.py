import hashlib, json, re, importlib.machinery, importlib.util, io, os, pathlib, subprocess, sys, tarfile, tempfile, time
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
 return dict(line.split("=",1) for line in (root/"release.env").read_text().splitlines())[key]
if args[0]=="image":print("a"*40);sys.exit(0)
if args[0]=="inspect":
 field=args[-1];image=env("NUTRITION_IMAGE");revision=env("DEPLOYED_COMMIT")
 if "Health.Status" in field:
  failed=(revision=="a"*40 and mode in ("health","rollback-health")) or (revision=="b"*40 and mode=="rollback-health" and (root/"up-count").exists())
  record("HEALTH "+revision);print("unhealthy" if failed else "healthy")
 elif "Config.Image" in field:print(image)
 else:print(revision)
 sys.exit(0)
if "run" in args and "groups=new Map" in args[-1]:record("PRUNE");sys.exit(1 if mode=="retention" else 0)
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
for mode in ("rewrite","ps","health","rollback-health","success","retention","invalid-release"):
 with tempfile.TemporaryDirectory() as d:
  root=pathlib.Path(d);bindir=root/"bin";bindir.mkdir()
  (root/"verification").mkdir()
  (root/"runtime.env").write_text("BETTER_AUTH_SECRET=synthetic-constant\n")
  (root/"compose.yaml").write_text("services: {}\n")
  (root/"compose.home.yaml").write_text("services: {}\n")
  (root/"release.env").write_text("DEPLOYED_COMMIT="+OLD+"\nNUTRITION_IMAGE=nutrition-release:"+OLD[:12]+"\n")
  if mode=="invalid-release":
   with (root/"release.env").open("a") as f:f.write("BETTER_AUTH_SECRET=forbidden\n")
  (bindir/"docker").write_text("#!"+sys.executable+"\n"+mock)
  (bindir/"curl").write_text("#!/bin/sh\nprintf 200\n")
  (bindir/"sleep").write_text("#!/bin/sh\nexit 0\n")
  (bindir/"python3").write_text("#!/bin/sh\n"+("exit 1\n" if mode=="rewrite" else "exec "+sys.executable+" \"$@\"\n"))
  for f in bindir.iterdir():f.chmod(0o700)
  script=(BASE/"upgrade-ci-release.sh.candidate").read_text().replace("cd /opt/compose/yazio-dashboard","cd "+str(root))
  run=subprocess.run(["bash","-c",script,"test",NEW],env=os.environ|dict(PATH=str(bindir)+":"+os.environ["PATH"],MODE=mode,CD_BACKUP_STAMP="20261012T120000Z-1"),capture_output=True,text=True,timeout=10)
  assert (root/"runtime.env").read_text()=="BETTER_AUTH_SECRET=synthetic-constant\n"
  assert not list(root.glob("runtime.env.*"))
  if mode=="invalid-release":
   assert run.returncode!=0 and not (root/"commands.log").exists()
   assert not (root/"verification/previous-release.env").exists()
   continue
  log=(root/"commands.log").read_text()
  if mode=="retention":
   assert run.returncode==0 and "RESTORE" not in log and "backup retention failed" in run.stderr
  elif mode=="success":assert run.returncode==0 and "RESTORE" not in log and "PRUNE" in log
  else:
   assert run.returncode!=0 and "PRUNE" not in log
   assert "UP "+OLD in log
   assert log.index("SNAPSHOT failed-before-rollback")<log.index("RESTORE pre-upgrade")
   if mode=="rollback-health":assert "ATTENTION" in run.stderr
   else:assert "previous exact healthy release restored" in run.stderr
print("PASS: injected env rewrite/compose-ps/new-health failures recover old exact healthy image; rollback-health failure alerts; success disarms trap; retention failure preserves healthy release; mixed secret/release rejected")

# Execute the actual embedded JavaScript, not a second implementation of retention.
script=(BASE/"upgrade-ci-release.sh.candidate").read_text()
blocks=re.findall(r"app -e '\n(.*?)\n *'",script,re.S)
assert len(blocks)==3
retention=blocks[2]
with tempfile.TemporaryDirectory() as d:
 root=pathlib.Path(d)
 stamps=[f"202610{i:02}T120000Z-1" for i in range(1,8)]
 def complete(kind,stamp):
  folder=root/(kind+"-"+stamp);folder.mkdir()
  files={}
  for name in ("snapshot.sqlite","snapshot-uploads.tar.gz","release.env","compose.yaml","compose.home.yaml","snapshot-yazio-connection.enc","snapshot-transformmate-connection.absent"):
   content=b"" if name.endswith(".absent") else b"synthetic fixture"
   (folder/name).write_bytes(content);files[name]=hashlib.sha256(content).hexdigest()
  (folder/"manifest.json").write_text(json.dumps(dict(format=1,stamp=stamp,image="nutrition-release:"+OLD[:12],revision=OLD,createdAt="2026-10-13T12:00:00Z",files=files)))
  return folder
 for stamp in stamps:
  for kind in ("pre-upgrade","failed-before-rollback"):complete(kind,stamp)
 protected=[]
 # All malformed sets are older than the five valid groups, so the old implementation deletes them.
 folder=root/"pre-upgrade-20260801T120000Z-1";folder.mkdir()
 (folder/"manifest.json").write_text(json.dumps(dict(format=1,stamp="20260801T120000Z-1")));protected.append(folder)
 for day,damage in enumerate(("missing-file","corrupt-file","missing-hash","bad-hash","symlink","unexpected-file"),2):
  stamp=f"202608{day:02}T120000Z-1";folder=complete("pre-upgrade",stamp)
  protected.append(folder);protected.append(complete("failed-before-rollback",stamp))
  manifest=folder/"manifest.json";payload=json.loads(manifest.read_text())
  if damage=="missing-file":(folder/"snapshot.sqlite").unlink()
  elif damage=="corrupt-file":(folder/"snapshot.sqlite").write_text("damaged")
  elif damage=="missing-hash":del payload["files"]["snapshot.sqlite"]
  elif damage=="bad-hash":payload["files"]["snapshot.sqlite"]="not-a-sha256"
  elif damage=="symlink":
   (folder/"snapshot.sqlite").unlink();(folder/"snapshot.sqlite").symlink_to(root/"outside.sqlite")
  elif damage=="unexpected-file":(folder/"unmanaged.txt").write_text("preserve")
  manifest.write_text(json.dumps(payload))
 # A damaged newest set must not displace any of the newest five valid groups.
 newest=complete("pre-upgrade","20261101T120000Z-1");(newest/"snapshot.sqlite").write_text("damaged");protected.append(newest)
 protected.append(complete("failed-before-rollback","20261101T120000Z-1"))
 incomplete=root/"pre-upgrade-20260901T120000Z-1";incomplete.mkdir()
 protected.append(complete("failed-before-rollback","20260901T120000Z-1"))
 legacy=root/"pre-upgrade-legacy.sqlite";legacy.write_text("old")
 outside=root/"unmanaged";outside.mkdir()
 subprocess.run(["node","-e",retention.replace('root="/app/data/cd-backups"','root='+json.dumps(d))],env=os.environ|dict(BACKUP_STAMP=stamps[0]),check=True)
 assert (root/("pre-upgrade-"+stamps[0])).exists()  # current set is always pinned
 assert not (root/("pre-upgrade-"+stamps[1])).exists()
 assert not (root/("failed-before-rollback-"+stamps[1])).exists()
 assert all(folder.exists() for folder in protected), "Incomplete/corrupt group was pruned"
 assert incomplete.exists() and legacy.exists() and outside.exists()
 assert all((root/("pre-upgrade-"+stamp)).exists() for stamp in stamps[2:])
print("PASS: real retention JS keeps latest five valid groups/current/incomplete/corrupt/symlink/legacy and preserves both halves of damaged groups")

if "--docker" in sys.argv:
 snapshot=re.search(r"snapshot\(\).*?app -e '\n(.*?)\n '",script,re.S)[1]
 restore=re.search(r"restore_snapshot\(\).*?app -e '\n(.*?)\n '",script,re.S)[1]
 suffix=str(os.getpid());data="tempo-cd-test-data-"+suffix;uploads="tempo-cd-test-uploads-"+suffix
 def docker(code,env=None,ok=True):
  args=["docker","run","--rm","--network","none","--user","root","-v",data+":/app/data","-v",uploads+":/app/uploads"]
  for k,v in (env or {}).items():args += ["-e",k+"="+v]
  result=subprocess.run(args+["--entrypoint","node","nutrition-foundation:latest","-e",code],capture_output=True,text=True)
  if ok and result.returncode:raise AssertionError(result.stderr)
  if not ok:assert result.returncode!=0
 try:
  docker("const fs=require('fs'),D=require('better-sqlite3');const d=new D('/app/data/nutrition.sqlite');d.exec('CREATE TABLE fixture(value TEXT); INSERT INTO fixture VALUES (\\'original\\')');d.close();fs.writeFileSync('/app/uploads/photo','original');fs.writeFileSync('/app/data/yazio-token.json','synthetic-encrypted');")
  env=dict(BACKUP_PREFIX="pre-upgrade-20261013T120000Z-1",BACKUP_STAMP="20261013T120000Z-1",BACKUP_IMAGE="nutrition-release:"+OLD[:12],BACKUP_REVISION=OLD,RELEASE_CONFIG="NUTRITION_IMAGE=fixture",BASE_CONFIG="services: {}",HOME_CONFIG="services: {}")
  docker(snapshot,env)
  docker("const fs=require('fs'),D=require('better-sqlite3');const d=new D('/app/data/nutrition.sqlite');d.exec('UPDATE fixture SET value=\\'failed\\'');d.close();fs.writeFileSync('/app/uploads/photo','failed');fs.writeFileSync('/app/data/yazio-token.json','failed');fs.writeFileSync('/app/data/transformmate-token.json','failed');")
  # A damaged backup must fail before touching live files.
  docker("const fs=require('fs'),p='/app/data/cd-backups/pre-upgrade-20261013T120000Z-1/compose.yaml';fs.writeFileSync(p,'damaged');")
  docker(restore,env,ok=False)
  docker("const fs=require('fs');if(fs.readFileSync('/app/uploads/photo','utf8')!=='failed')process.exit(1);fs.writeFileSync('/app/data/cd-backups/pre-upgrade-20261013T120000Z-1/compose.yaml','services: {}\\n');")
  docker(restore,env)
  docker("const fs=require('fs'),D=require('better-sqlite3');const d=new D('/app/data/nutrition.sqlite');if(d.prepare('SELECT value FROM fixture').get().value!=='original')process.exit(1);d.close();if(fs.readFileSync('/app/uploads/photo','utf8')!=='original'||fs.readFileSync('/app/data/yazio-token.json','utf8')!=='synthetic-encrypted'||fs.existsSync('/app/data/transformmate-token.json'))process.exit(1);")
  print("PASS: disposable Docker snapshot manifest/checksums, corruption refusal, DB/uploads/encrypted-file restore and absence marker")
 finally:
  subprocess.run(["docker","volume","rm",data,uploads],check=True,stdout=subprocess.DEVNULL)
