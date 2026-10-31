"""Probe an isolated app-server without credentials or model inference.

Creates only temporary threads; stores allowlisted, redacted observations.
This is research code, not the scene-craft runtime.
"""

import subprocess, os, json, tempfile, selectors, time, pathlib, argparse
from datetime import datetime
from zoneinfo import ZoneInfo
parser = argparse.ArgumentParser(description='Non-inference app-server capability probe')
parser.add_argument('--out', type=pathlib.Path, default=pathlib.Path('/tmp/scene-craft-ui-probe-result.json'))
args = parser.parse_args()
version = subprocess.check_output(['codex', '--version'], text=True, stderr=subprocess.DEVNULL).strip().removeprefix('codex-cli ')
base = pathlib.Path(tempfile.mkdtemp(prefix='scene-craft-26-rpc-'))
home = base / 'codex'
home.mkdir()
work = base / 'work'
work.mkdir()
env = {k: v for k, v in os.environ.items() if k not in ['OPENAI_API_KEY', 'CODEX_API_KEY', 'ACCESS_TOKEN']}
env['CODEX_HOME'] = str(home)
cmd = ['codex', 'app-server', '--listen', 'stdio://', '-c', 'model_provider="openai"', '-c', 'forced_login_method="chatgpt"', '-c', 'web_search="disabled"']
p = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env, text=True, bufsize=1)
sel = selectors.DefaultSelector()
sel.register(p.stdout, selectors.EVENT_READ)
rows = []
events = []
seq = 0

def rpc(method, params):
    global seq
    seq += 1
    ident = seq
    p.stdin.write(json.dumps({'id': ident, 'method': method, 'params': params}) + '\n')
    p.stdin.flush()
    deadline = time.monotonic() + 25
    while time.monotonic() < deadline:
        if not sel.select(timeout=1):
            continue
        line = p.stdout.readline()
        if not line:
            raise RuntimeError('server exited')
        obj = json.loads(line)
        if obj.get('id') == ident and ('result' in obj or 'error' in obj):
            rows.append({'method': method, 'ok': 'result' in obj, 'result': obj.get('result'), 'error': obj.get('error')})
            return obj.get('result')
        if 'method' in obj:
            events.append(obj['method'])
    raise TimeoutError(method)
try:
    init = rpc('initialize', {'clientInfo': {'name': 'scene_craft_capability_probe', 'version': '0.1.0'}, 'capabilities': {'experimentalApi': False}})
    p.stdin.write(json.dumps({'method': 'initialized'}) + '\n')
    p.stdin.flush()
    rpc('account/read', {'refreshToken': False})
    rpc('model/list', {'limit': 2})
    threads = []
    for i in range(2):
        r = rpc('thread/start', {'cwd': str(work), 'sandbox': 'read-only', 'approvalPolicy': 'never', 'ephemeral': False})
        threads.append(r['thread']['id'])
    rpc('thread/name/set', {'threadId': threads[0], 'name': 'scene-craft capability probe'})
    rpc('thread/read', {'threadId': threads[0], 'includeTurns': True})
    rpc('thread/loaded/list', {})
    rpc('thread/list', {'cwd': str(work), 'limit': 10})
    rpc('thread/resume', {'threadId': threads[0]})
finally:
    p.terminate()
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        p.kill()
        p.wait()
out = {'checked_on': datetime.now(ZoneInfo('Asia/Tokyo')).date().isoformat(), 'cli_version': version, 'isolation': 'temporary empty CODEX_HOME; no auth copied; no turn/start; no inference', 'initialize_user_agent': init.get('userAgent') if init else None, 'checks': [], 'notification_methods': sorted(set(events))}
for row in rows:
    r = row['result'] or {}
    entry = {'method': row['method'], 'ok': row['ok']}
    if row['error']:
        entry['error'] = row['error']
    if row['method'] == 'account/read':
        entry['account_is_null'] = r.get('account') is None
    if row['method'] == 'model/list':
        entry['catalog_entries'] = len(r.get('data', []))
        entry['has_next_cursor'] = bool(r.get('nextCursor'))
    if row['method'] in ['thread/start', 'thread/read', 'thread/resume'] and row['ok']:
        t = r['thread']
        entry.update({'thread_alias': 'A' if t['id'] == threads[0] else 'B', 'status': t.get('status'), 'name': t.get('name'), 'turn_count': len(t.get('turns', [])), 'history_mode': t.get('historyMode')})
    if row['method'] == 'thread/loaded/list':
        entry['loaded_count'] = len(r.get('data', []))
    if row['method'] == 'thread/list':
        entry['stored_count'] = len(r.get('data', []))
    out['checks'].append(entry)
s = json.dumps(out, ensure_ascii=False, indent=2)
for i, t in enumerate(threads):
    s = s.replace(t, ['<thread-A>', '<thread-B>'][i])
s = s.replace(str(base), '<temporary-root>')
args.out.write_text(s + '\n')
print(s)
