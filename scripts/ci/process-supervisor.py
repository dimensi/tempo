"""Linux child subreaper for disposable browser commands; no privilege changes."""
import ctypes
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
    raise OSError(ctypes.get_errno(), 'Cannot enable child subreaper')

cancelled = 0

def cancel(number, _frame):
    global cancelled
    cancelled = number

signal.signal(signal.SIGINT, cancel)
signal.signal(signal.SIGTERM, cancel)
child = subprocess.Popen(sys.argv[1:])
while child.poll() is None and not cancelled:
    time.sleep(0.02)
status = child.returncode

def children():
    owned = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            text = (entry / 'stat').read_text()
            parent = int(text[text.rfind(') ') + 2:].split()[1])
            if parent == os.getpid():
                owned.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError):
            pass
    return owned

def send_owned(pid, number):
    try:
        # pidfd binds the signal to the original process, preventing PID reuse.
        descriptor = os.pidfd_open(pid)
        try:
            text = Path(f'/proc/{pid}/stat').read_text()
            parent = int(text[text.rfind(') ') + 2:].split()[1])
            if parent == os.getpid():
                signal.pidfd_send_signal(descriptor, number)
        finally:
            os.close(descriptor)
    except ProcessLookupError:
        pass
    except FileNotFoundError:
        pass

def reap():
    global status
    while True:
        try:
            pid, result = os.waitpid(-1, os.WNOHANG)
            if not pid:
                return
            if pid == child.pid:
                status = os.waitstatus_to_exitcode(result)
        except ChildProcessError:
            return

# Detached and newly orphaned descendants are adopted by this reaper, including
# children created after TERM. Repeat until the kernel child list is empty.
term_deadline = time.monotonic() + 2
kill_deadline = term_deadline + 1
while children():
    number = signal.SIGTERM if time.monotonic() < term_deadline else signal.SIGKILL
    for pid in children():
        send_owned(pid, number)
    reap()
    if time.monotonic() > kill_deadline and children():
        sys.exit(125)
    time.sleep(0.02)
reap()
code = 128 + cancelled if cancelled else status
sys.exit(code if code is not None and code >= 0 else 128 - (code or 0))
