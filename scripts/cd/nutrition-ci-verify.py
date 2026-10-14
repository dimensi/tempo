#!/usr/bin/env python3
import hashlib
import json
import re
import sys
from pathlib import Path

FIELDS = ("Env", "Entrypoint", "Cmd", "User", "WorkingDir", "ExposedPorts", "Labels")

def verify_run(run, jobs, revision):
    assert run["event"] == "push" and run["head_branch"] == "main"
    assert run["head_sha"] == revision
    assert run["status"] == "completed" and run["conclusion"] == "success"
    for name in ("docker",):
        matches = [job for job in jobs["jobs"] if job["name"] == name]
        assert len(matches) == 1
        assert matches[0]["status"] == "completed" and matches[0]["conclusion"] == "success"

def verify_manifest(manifest, revision, tree, archive):
    assert manifest["revision"] == revision and manifest["tree"] == tree
    assert manifest["imageTag"] == "nutrition-release:" + revision[:12]
    assert re.fullmatch(r"[0-9a-f]{64}", manifest["archiveSHA256"])
    digest = hashlib.sha256()
    with archive.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    assert digest.hexdigest() == manifest["archiveSHA256"]
    assert set(manifest["runtimeConfig"]) == set(FIELDS)
    labels = manifest["runtimeConfig"]["Labels"]
    assert labels["org.opencontainers.image.revision"] == revision
    assert labels["org.opencontainers.image.tree"] == tree
    assert isinstance(manifest["rootFSDiffIDs"], list) and manifest["rootFSDiffIDs"]

def verify_image(manifest, image):
    assert image["RootFS"]["Layers"] == manifest["rootFSDiffIDs"]
    assert {field: image["Config"].get(field) for field in FIELDS} == manifest["runtimeConfig"]
    labels = image["Config"]["Labels"]
    assert labels["org.opencontainers.image.revision"] == manifest["revision"]
    assert labels["org.opencontainers.image.tree"] == manifest["tree"]
    return {"revision": manifest["revision"], "imageId": image["Id"], "verified": True}

if __name__ == "__main__":
    mode, *args = sys.argv[1:]
    if mode == "run":
        run, jobs, revision = args
        verify_run(json.loads(Path(run).read_text()), json.loads(Path(jobs).read_text()), revision)
    elif mode == "manifest":
        manifest, revision, tree, archive = args
        verify_manifest(json.loads(Path(manifest).read_text()), revision, tree, Path(archive))
    elif mode == "image":
        print(json.dumps(verify_image(json.loads(Path(args[0]).read_text()), json.load(sys.stdin)[0])))
    else:
        raise ValueError("Unsupported verification mode")
