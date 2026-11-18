"""Freeze a channel folder (beta/ or live/) into releases/<id>/ and print its SHA-384 hashes.

    python3 tools/make_release.py beta 2026-11-18-v2      # copy + hash
    git add releases/2026-11-18-v2 && git commit && git push
    python3 tools/make_release.py --pin 2026-11-18-v2     # after the push: the LIVE_RELEASE line

A release folder is never edited after it's pinned; make a new id instead.
"""
import base64, hashlib, json, pathlib, shutil, subprocess, sys
ROOT = pathlib.Path(__file__).resolve().parent.parent
FILES = ['styles.css', 'data.js', 'persistence.js', 'game.js']

def sri(path):
    return 'sha384-' + base64.b64encode(hashlib.sha384(path.read_bytes()).digest()).decode()

def freeze(channel, rid):
    dst = ROOT / 'releases' / rid
    if dst.exists():
        sys.exit(f'releases/{rid} already exists; releases are immutable, pick a new id')
    dst.mkdir(parents=True)
    for f in FILES:
        shutil.copyfile(ROOT / channel / f, dst / f)
    (dst / 'HASHES.json').write_text(json.dumps({f: sri(dst / f) for f in FILES}, indent=2) + '\n')
    print(f'froze {channel}/ -> releases/{rid}/')

def pin(rid):
    d = ROOT / 'releases' / rid
    hashes = {f: sri(d / f) for f in FILES}
    stored = json.loads((d / 'HASHES.json').read_text())
    assert hashes == stored, 'release files changed since they were frozen'
    rel = str(d.relative_to(ROOT.parent))
    sha = subprocess.check_output(['git', 'log', '-1', '--format=%H', '--', rel], cwd=ROOT.parent, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--', rel], cwd=ROOT.parent, text=True).strip()
    assert sha and not dirty, 'commit and push the release folder first'
    print(json.dumps({'id': rid, 'sha': sha, 'files': hashes}, separators=(',', ':')))

if __name__ == '__main__':
    if sys.argv[1] == '--pin': pin(sys.argv[2])
    else: freeze(sys.argv[1], sys.argv[2])
