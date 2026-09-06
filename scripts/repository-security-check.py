#!/usr/bin/env python3
"""Check tracked source without printing secret values. This is not a history scan."""
import pathlib
import re
import subprocess
import sys

RULES = (
    ("private-key", re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----")),
    ("github-token", re.compile(rb"\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b")),
    ("stripe-secret", re.compile(rb"\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b")),
    ("aws-access-key", re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b")),
    ("slack-token", re.compile(rb"\bxox[baprs]-[A-Za-z0-9-]{20,}\b")),
    ("openai-project-key", re.compile(rb"\bsk-proj-[A-Za-z0-9_-]{40,}\b")),
)

def path_violation(name):
    parts = pathlib.PurePosixPath(name).parts
    if any(part in {'.playwright-cli', '.playwright-mcp'} for part in parts):
        return 'browser-capture'
    base = parts[-1]
    if parts[0] in {'memory', 'zoho_exports'} or base == 'MEMORY.md':
        return 'private-runtime-data'
    if base in {'.env', '.netrc', 'id_rsa', 'id_ed25519'}:
        return 'local-credential-file'
    if base.startswith('.env.') and not base.endswith(('.example', '.sample', '.template')):
        return 'local-environment-file'
    return None

def findings(files):
    result = []
    for name, data in files:
        violation = path_violation(name)
        if violation:
            result.append((name, violation))
        # Binary files are still subject to path checks; don't treat them as text.
        if b'\0' in data:
            continue
        for rule, pattern in RULES:
            if pattern.search(data):
                result.append((name, rule))
    return result

def main():
    paths = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
    files = []
    for name in filter(None, paths):
        # Scan the index, not symlink targets or unrelated untracked files.
        data = subprocess.check_output(['git', 'show', ':' + name])
        files.append((name, data))
    hits = findings(files)
    for name, rule in hits:
        print(f'{rule}: {name}')
    print(f'Checked {len(files)} tracked files; {len(hits)} finding(s). Values withheld.')
    return bool(hits)

if __name__ == '__main__':
    sys.exit(main())
