#!/usr/bin/env python3
"""Independently assert the archived outputs, rather than trusting the report."""
import hashlib
import json
from pathlib import Path
import sys

base = Path(__file__).resolve().parent
positive, *negative = sys.argv[1:]
def meta(name):
    return json.loads((base / name / '退出码与用时.json').read_text())
def run(name):
    folders = list((base / name).glob('e2e-*'))
    assert len(folders) == 1, (name, folders)
    folder = folders[0]
    lifecycle = json.loads((folder / 'collab-load-lifecycle.json').read_text())
    events = [json.loads(line) for line in (folder / 'engine-state/process-events.jsonl').read_text().splitlines()]
    results = [json.loads(line) for line in (folder / 'test-results.jsonl').read_text().splitlines()]
    return folder, lifecycle, events, results

for name in ['30-typecheck-electron最终', '31-typecheck-runtime最终', '32-test-electron最终全量', '33-test-prepush最终全量', '34-主审34项反例最终', positive]:
    assert meta(name)['exit_code'] == 0, name
for name in ['30-typecheck-electron最终', '31-typecheck-runtime最终']:
    assert meta(name)['error_TS_count'] == 0, name
def skill_hash(skill):
    fields = [skill.get(key, '').strip() for key in ['name', 'description', 'content']]
    return hashlib.sha256(json.dumps(fields, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest()

protocol = list((base / '32-test-electron最终全量').glob('protocol-*.json'))
assert len(protocol) == 19
for file in protocol:
    case = json.loads(file.read_text())
    assert case['startCount'] == len(case['starts']) == 1 and case['starts'][0]['hasApiKey'] is False
    success_count = sum(entry['enrichmentFailed'] is False for entry in case['cache']['entries'].values())
    assert success_count == (0 if case['result']['enrichmentFailed'] else 1)
quota = json.loads((base / '32-test-electron最终全量/actual-quota.json').read_text())
quota_events = [json.loads(line) for line in quota['events'].splitlines()]
assert len(quota['outcomes']) == 50
assert sum(event['event'] == 'START' and event['sample'] < 50 for event in quota_events) == 20
assert 14500 <= quota['outcomes'][0]['elapsed'] < 20000
windows = json.loads((base / '32-test-electron最终全量/actual-two-windows.json').read_text())
assert len(set(windows['windowIds'])) == 2 and windows['maximum'] == 3 and windows['active'] == 0
folder, lifecycle, events, results = run(positive)
assert len(results) == 5 and all(result['status'] == 'passed' for result in results)
assert [step['actualStarts'] for step in lifecycle['pageChecks']] == [1, 1, 2]
assert len(lifecycle['phases']) == 3
cache = json.loads((folder / 'skill-taxonomy-cache.json').read_text())['entries']
for step in lifecycle['pageChecks']:
    assert skill_hash(step['skill']) == step['hash']
    assert cache[step['hash']]['name'] == step['skill']['name']
phases = []
for phase in lifecycle['phases']:
    begin, complete = phase['boundaries']
    assert begin['boundary'] == 'start' and complete['boundary'] == 'complete'
    assert len(phase['liveProcesses']) == 3
    assert all(proc['alive'] for boundary in [begin, complete] for proc in boundary['pids'])
    for proc in phase['liveProcesses']:
        starts = [event for event in events if event['pid'] == proc['pid'] and event['event'] == 'START']
        ends = [event for event in events if event['pid'] == proc['pid'] and event['event'] == 'END']
        assert len(starts) == len(ends) == 1
        assert starts[0]['at'] <= begin['at'] <= complete['at'] <= ends[0]['endTime']
        skill = next(skill for skill in phase['skills'] if skill['description'] == proc['description'])
        assert skill_hash(skill) == skill['hash']
        assert cache[skill['hash']]['name'] == skill['name'] and cache[skill['hash']]['enrichmentFailed'] is False
    phases.append({'phase': phase['phase'], 'node': phase['node'], 'pids': [p['pid'] for p in phase['liveProcesses']], 'node_ms': complete['at'] - begin['at']})
active = maximum = 0
for event in events:
    active += 1 if event['event'] == 'START' else -1
    maximum = max(maximum, active)
assert active == 0 and maximum == 3
reverse = []
for index, name in enumerate(negative):
    assert meta(name)['exit_code'] == 1, name
    _, proof, raw, cases = run(name)
    assert len(cases) == 1 and cases[0]['status'] == 'failed'
    log = (base / name / '原始输出.log').read_text()
    if index < 3:
        assert ['res.success', 'countRunningEngineProcesses', 'approved: true'][index] in log, name
    else:
        phase = proof['phases'][-1]
        assert phase['phase'] == index - 2
        boundary = phase['boundaries'][-1]
        assert phase['endedBeforeNodeAt'] <= boundary['at']
        assert boundary['boundary'] == 'start' and all(not proc['alive'] for proc in boundary['pids'])
        for proc in phase['liveProcesses']:
            end = next(event for event in raw if event['pid'] == proc['pid'] and event['event'] == 'END')
            assert proc['startTime'] <= phase['capturedAt'] <= end['endTime'] <= phase['endedBeforeNodeAt']
        assert 'main-chain node' in log
    reverse.append({'run': name, 'exit_code': 1, 'body_ms': cases[0]['observedBodyMs']})
print(json.dumps({'verified': True, 'page_start_counts': [1,1,2], 'maximum_actual_processes': maximum, 'phases': phases, 'negative_runs': reverse, 'positive_total_seconds': meta(positive)['total_seconds'], 'positive_observed_test_body_ms': sum(result['observedBodyMs'] for result in results)}, ensure_ascii=False, indent=2))
