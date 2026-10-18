"""Open/close the CI-only SSH forward to Coolify. Uses Python stdlib + OpenSSH."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request

os.umask(0o077)


def close(base):
    if not base.exists():
        return
    record = base / "connection.json"
    try:
        if record.exists():
            connection = json.loads(record.read_text())
            subprocess.run(
                ["ssh", "-F", "/dev/null", "-S", str(base / "control"), "-O", "exit",
                 "-p", connection["port"], "-l", connection["user"], connection["host"]],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10,
            )
    finally:
        shutil.rmtree(base)


def start():
    names = ["HOST", "PORT", "USER", "KEY", "KNOWN_HOSTS"]
    values = {name: os.environ.get("COOLIFY_SSH_" + name, "").strip() for name in names}
    if not all(values.values()):
        raise RuntimeError("Required Coolify SSH production secret missing")
    host, user = values["HOST"], values["USER"]
    if host.startswith("-") or user.startswith("-") or any(c.isspace() for c in host + user):
        raise RuntimeError("Invalid SSH endpoint")
    port = str(int(values["PORT"]))
    if not 1 <= int(port) <= 65535:
        raise RuntimeError("Invalid SSH port")
    base = Path(tempfile.mkdtemp(prefix="coolify-ssh-", dir=os.environ["RUNNER_TEMP"]))
    try:
        key, known = base / "key", base / "known_hosts"
        key.write_text(values["KEY"].replace("\r", "") + "\n")
        known.write_text(values["KNOWN_HOSTS"].replace("\r", "") + "\n")
        connection = {"host": host, "port": port, "user": user}
        (base / "connection.json").write_text(json.dumps(connection))
        args = [
            "ssh", "-F", "/dev/null", "-p", port, "-l", user, "-i", str(key),
            "-M", "-S", str(base / "control"), "-f", "-N", "-T",
            "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes",
            "-o", "StrictHostKeyChecking=yes", "-o", "GlobalKnownHostsFile=/dev/null",
            "-o", "UserKnownHostsFile=" + str(known), "-o", "ConnectTimeout=20",
            "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=15",
            "-o", "ServerAliveCountMax=2", "-L", "127.0.0.1:18000:127.0.0.1:8000", host,
        ]
        result = subprocess.run(args, capture_output=True, text=True, timeout=35)
        if result.returncode:
            category = "SSH authentication or forwarding failed"
            if "Host key verification failed" in result.stderr or "REMOTE HOST IDENTIFICATION" in result.stderr:
                category = "SSH server host key does not match the trusted key"
            elif "timed out" in result.stderr:
                category = "SSH connection timed out"
            raise RuntimeError(category)
        try:
            direct = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with direct.open("http://127.0.0.1:18000/api/v1/applications", timeout=15) as response:
                status = response.status
        except urllib.error.HTTPError as error:
            status = error.code
        if status != 401:
            raise RuntimeError("Tunnel did not reach the authenticated Coolify API")
        with open(os.environ["GITHUB_ENV"], "a") as environment:
            environment.write("COOLIFY_TUNNEL_DIR=" + str(base) + "\n")
            bypass = os.environ.get("no_proxy", os.environ.get("NO_PROXY", ""))
            bypass = ",".join(filter(None, [bypass, "127.0.0.1", "localhost", "::1"]))
            environment.write("NO_PROXY=" + bypass + "\nno_proxy=" + bypass + "\n")
        print("SSH tunnel ready; local Coolify API requires authentication")
    except BaseException:
        close(base)
        raise


def stop():
    value = os.environ.get("COOLIFY_TUNNEL_DIR")
    if not value:
        return
    base = Path(value).resolve()
    if base.parent != Path(os.environ["RUNNER_TEMP"]).resolve() or not base.name.startswith("coolify-ssh-"):
        raise RuntimeError("Unexpected tunnel state directory")
    close(base)
    print("SSH tunnel closed and temporary key removed")


if __name__ == "__main__":
    try:
        {"start": start, "stop": stop}[sys.argv[1]]()
    except (Exception, KeyboardInterrupt) as error:
        print("Coolify tunnel failed: " + str(error), file=sys.stderr)
        raise SystemExit(1)
