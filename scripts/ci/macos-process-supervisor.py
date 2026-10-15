"""Disposable macOS browser tree: inherited ownership token includes detached children.

Only process identities and the random test token are inspected. Environment and
command output are never logged or persisted. Linux keeps its kernel subreaper.
"""
import os
import signal
import subprocess
import sys
import time
import uuid

cancelled = 0

def cancel(number, _frame):
    global cancelled
    cancelled = number

signal.signal(signal.SIGINT, cancel)
signal.signal(signal.SIGTERM, cancel)
token = f"YAZIO_BROWSER_PROCESS_TOKEN={uuid.uuid4().hex}"
key, value = token.split("=", 1)
child = subprocess.Popen(sys.argv[1:], env={**os.environ, key: value}, start_new_session=True)
while child.poll() is None and not cancelled:
    time.sleep(0.02)
status = child.returncode

def owned():
    result = subprocess.run(
        ["ps", "eww", "-axo", "pid=,lstart=,command="],
        check=True, capture_output=True, text=True,
    )
    processes = {}
    for line in result.stdout.splitlines():
        fields = line.split(None, 6)
        if len(fields) == 7 and token in fields[6].split():
            processes[int(fields[0])] = fields[1:6]
    return processes

def send_owned(pid, identity, number):
    # Check birth time and inherited token immediately before signalling. No
    # executable-name or global port matching can kill unrelated local servers.
    result = subprocess.run(
        ["ps", "eww", "-p", str(pid), "-o", "pid=,lstart=,command="],
        capture_output=True, text=True,
    )
    fields = result.stdout.split(None, 6)
    if len(fields) != 7 or fields[1:6] != identity or token not in fields[6].split():
        return
    try:
        os.kill(pid, number)
    except ProcessLookupError:
        pass

term_deadline = time.monotonic() + 2
kill_deadline = term_deadline + 3
while True:
    processes = owned()
    if not processes:
        break
    number = signal.SIGTERM if time.monotonic() < term_deadline else signal.SIGKILL
    for pid, identity in processes.items():
        send_owned(pid, identity, number)
    child.poll()  # Reap our direct child, including cancellation.
    if time.monotonic() > kill_deadline and owned():
        sys.exit(125)
    time.sleep(0.02)
child.wait()
code = 128 + cancelled if cancelled else child.returncode
sys.exit(code if code is not None and code >= 0 else 128 - (code or 0))
