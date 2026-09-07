#!/usr/bin/env python3
"""Run one gate with its own immutable evidence directory and real exit status."""
import datetime
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import time

name, cwd, *command = sys.argv[1:]
directory = Path(__file__).resolve().parent / name
directory.mkdir()  # Refuse to overwrite an earlier run, including a failed run.
env = dict(os.environ, NIMBALYST_GN_EVIDENCE_DIR=str(directory))
is_e2e = any('playwright' in arg or 'test:e2e:collab' in arg for arg in command)
if is_e2e:
    checks = []
    for port in [5273, 8234, 9333]:
        check = subprocess.run(['lsof', '-nP', f'-iTCP:{port}', '-sTCP:LISTEN'], capture_output=True, text=True)
        checks.append({'port': port, 'exit_code': check.returncode, 'stdout': check.stdout})
    (directory / 'port-before.json').write_text(json.dumps(checks, indent=2))
    if any(check['exit_code'] != 1 or check['stdout'] for check in checks):
        raise SystemExit('Port owned by another process; refusing to start E2E.')
    time.sleep(3)
started = datetime.datetime.now().astimezone().isoformat()
t0 = time.monotonic()
with (directory / '原始输出.log').open('w') as log:
    result = subprocess.run(command, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
elapsed = time.monotonic() - t0
if is_e2e:
    artifacts = Path(__file__).resolve().parents[2] / 'e2e_test_output/test-results'
    if artifacts.exists():
        shutil.copytree(artifacts, directory / 'playwright-artifacts')
    layouts = artifacts.parent / 'plan-approval-layout'
    if layouts.exists():
        for file in layouts.iterdir():
            if file.is_file() and file.stat().st_mtime >= datetime.datetime.fromisoformat(started).timestamp():
                (directory / 'plan-approval-layout').mkdir(exist_ok=True)
                shutil.copy2(file, directory / 'plan-approval-layout' / file.name)
    after = subprocess.run(['lsof', '-nP', '-iTCP:5273', '-sTCP:LISTEN'], capture_output=True, text=True)
    (directory / 'port-after.json').write_text(json.dumps({'exit_code': after.returncode, 'stdout': after.stdout}, indent=2))
raw = (directory / '原始输出.log').read_text(errors='replace')
metadata = {
    'command': shlex.join(command), 'cwd': cwd, 'started_at': started,
    'ended_at': datetime.datetime.now().astimezone().isoformat(),
    'exit_code': result.returncode, 'total_seconds': round(elapsed, 3),
    'test_duration_lines': [line.strip() for line in raw.splitlines()
                            if re.search(r'Duration\s+\d|\d+ (?:passed|failed) \(', line)],
    'test_case_duration_lines': [line.strip() for line in raw.splitlines() if re.search(r'[✓✘].*\([0-9.]+[ms]+\)', line)],
    'error_TS_count': len(re.findall(r'error TS', raw)),
}
(directory / '退出码与用时.json').write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n')
(directory / 'exitcode.txt').write_text(str(result.returncode) + '\n')
print(json.dumps(metadata, ensure_ascii=False, indent=2))
print('\n'.join(raw.splitlines()[-10:]))
sys.exit(result.returncode)
