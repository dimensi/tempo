#!/usr/bin/python3
"""Allowlisted runtime configuration; never print configuration or exception text."""
import json
import os
import pathlib
import re
import stat
import sys
import tempfile

PROJECT = pathlib.Path('/opt/compose/yazio-dashboard')
MAX_CONFIG = 16384
KEYS = (
    'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY', 'ANAMNESIS_LLM_API_KEY', 'ANAMNESIS_LLM_BASE_URL',
    'ANAMNESIS_LLM_MODEL', 'ANAMNESIS_LLM_TIMEOUT_MS', 'ENABLE_ANAMNESIS_WORKER',
)
FIXED = {
    'S3_ENDPOINT': 'http://192.168.1.90:8333',
    'S3_REGION': 'us-east-1', 'S3_BUCKET': 'apps',
    'ANAMNESIS_LLM_BASE_URL': 'https://api.z.ai/api/coding/paas/v4',
    'ANAMNESIS_LLM_MODEL': 'glm-5.3-flash',
    'ANAMNESIS_LLM_TIMEOUT_MS': '120000', 'ENABLE_ANAMNESIS_WORKER': 'false',
}


def unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('Duplicate key')
        result[key] = value
    return result


def validate(payload):
    if not 0 < len(payload) <= MAX_CONFIG:
        raise ValueError('Config size')
    config = json.loads(payload, object_pairs_hook=unique)
    if type(config) is not dict or set(config) != {'version', 'runtime'}:
        raise ValueError('Envelope')
    if type(config['version']) is not int or config['version'] != 2:
        raise ValueError('Version')
    values = config['runtime']
    if type(values) is not dict or set(values) != set(KEYS):
        raise ValueError('Allowlist')
    for key, value in values.items():
        # Single-quoted Compose dotenv values are literal. Reject quote/backslash,
        # controls and non-ASCII rather than accepting ambiguous dotenv escapes.
        if type(value) is not str or not 1 <= len(value) <= 2048:
            raise ValueError('Value type/length')
        if any(ord(c) < 32 or ord(c) > 126 or c in "'\\" for c in value):
            raise ValueError('Value encoding')
        if key in FIXED and value != FIXED[key]:
            raise ValueError('Unapproved setting')
    return values


def protected_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError('Unprotected file')
    return info


def atomic(path, data, info):
    fd, name = tempfile.mkstemp(prefix='.' + path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), stat.S_IMODE(info.st_mode))
            os.fchown(output.fileno(), info.st_uid, info.st_gid)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        pathlib.Path(name).unlink(missing_ok=True)


def updated(original, values):
    # Preserve every unrelated byte (especially auth). Refuse multiline or
    # duplicate managed assignments instead of guessing their interpretation.
    lines = original.splitlines(keepends=True)
    seen = set()
    result = []
    pattern = re.compile(rb'^\s*(?:export\s+)?(' + b'|'.join(k.encode() for k in KEYS) + rb')\s*=')
    for line in lines:
        assignment = re.match(rb'^\s*(?:export\s+)?[A-Za-z_][A-Za-z_0-9]*\s*=(.*)', line)
        if assignment:
            value = assignment[1].strip()
            if value.startswith((b"'", b'"')) and (len(value) < 2 or value[-1:] != value[:1]):
                raise ValueError('Multiline dotenv requires operator review')
        match = pattern.match(line)
        if match:
            key = match[1].decode('ascii')
            if key in seen:
                raise ValueError('Duplicate managed assignment')
            seen.add(key)
            old = line[match.end():].strip()
            if old.startswith((b"'", b'"')) and (len(old) < 2 or old[-1:] != old[:1]):
                raise ValueError('Multiline managed assignment')
            continue
        result.append(line)
    preserved = b''.join(result)
    if preserved and not preserved.endswith(b'\n'):
        preserved += b'\n'
    return preserved + ''.join(f"{key}='{values[key]}'\n" for key in KEYS).encode('ascii')


def backup_path(stamp):
    if not re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[0-9]{1,20}', stamp):
        raise ValueError('Stamp')
    parent = PROJECT / 'verification/runtime-backups'
    if parent.is_symlink():
        raise ValueError('Backup path')
    parent.mkdir(mode=0o700, exist_ok=True)
    info = parent.stat()
    if info.st_uid != os.geteuid() or info.st_mode & 0o077:
        raise ValueError('Backup protection')
    return parent / (stamp + '.env')


def read_source(source):
    incoming = PROJECT / 'verification/ci-incoming'
    if source.name != 'runtime-config.json' or source.parent.parent != incoming:
        raise ValueError('Config source path')
    if source.parent.is_symlink() or incoming.is_symlink():
        raise ValueError('Config source link')
    protected_file(source)
    return validate(source.read_bytes())


def needs_inventory(source):
    values = read_source(source)
    runtime = PROJECT / 'runtime.env'
    protected_file(runtime)
    original = runtime.read_bytes()
    # The identical canonical S3 block means no storage switch. Anything else
    # fails closed to inventory (including credentials rotation).
    return any(original.splitlines().count(f"{key}='{values[key]}'".encode('ascii')) != 1
               for key in KEYS if key.startswith('S3_'))


def apply(stamp, source):
    values = read_source(source)
    runtime = PROJECT / 'runtime.env'
    info = protected_file(runtime)
    original = runtime.read_bytes()
    replacement = updated(original, values)
    backup = backup_path(stamp)
    fd, name = tempfile.mkstemp(prefix='.runtime-backup.', dir=backup.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            os.fchmod(output.fileno(), 0o600)
            output.write(original)
            output.flush()
            os.fsync(output.fileno())
        # Atomic, no-replace publication: restore never sees a partial backup.
        os.link(name, backup)
        directory = os.open(backup.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        pathlib.Path(name).unlink(missing_ok=True)
    atomic(runtime, replacement, info)


def restore(stamp):
    backup = backup_path(stamp)
    # Apply may fail before creating a backup; no mutation has occurred then.
    if not backup.exists():
        return
    protected_file(backup)
    runtime = PROJECT / 'runtime.env'
    atomic(runtime, backup.read_bytes(), protected_file(runtime))


if __name__ == '__main__':
    try:
        if os.geteuid() != 0:
            raise ValueError('Root required')
        if len(sys.argv) == 4 and sys.argv[1] == 'apply':
            apply(sys.argv[2], pathlib.Path(sys.argv[3]))
        elif len(sys.argv) == 3 and sys.argv[1] == 'restore':
            restore(sys.argv[2])
        elif len(sys.argv) == 3 and sys.argv[1] == 'inventory':
            print('required' if needs_inventory(pathlib.Path(sys.argv[2])) else 'unchanged')
        else:
            raise ValueError('Arguments')
    except Exception:
        print('Nutrition runtime configuration failed', file=sys.stderr)
        sys.exit(1)
