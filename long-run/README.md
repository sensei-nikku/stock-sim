# The Long Run — game client

The Long Run runs as a Google Apps Script web app. The Apps Script project holds the
**shell, the server and the release gate**; the game code students run lives here.

| Where | What | Who changes it |
|---|---|---|
| Apps Script `Index.html` | Shell: injects the save + the approved release, loads the files with hash checks | Pasted once (copy in `apps-script/Index.html`) |
| Apps Script `Release.gs` | Reads the release pin from Script Properties | Pasted once (copy in `apps-script/Release.gs`) |
| Apps Script **Script Property `LIVE_RELEASE`** | The pin: release id, commit, SHA-384 of every file | **The teacher, to approve a release** |
| Apps Script `Code.gs`, `Market.gs` | Login, saves, phase machine; future prices | Apps Script only — **Market.gs never goes in this public repo** |
| `releases/<id>/` | Frozen, approved builds. Never edited after pinning; a change = a new id | `tools/make_release.py` |
| `beta/` | Test build. Only teacher accounts can load it (`?beta=1`) | Push freely |
| `live/` | Old unpinned channel for the v1 shell; delete once the v2 shell is pasted | — |

## How a release works (supply-chain gate)
1. Build and test in `beta/`; the teacher plays it with `?beta=1`.
2. `python3 tools/make_release.py beta <id>` freezes it into `releases/<id>/`; commit and push.
3. `python3 tools/make_release.py --pin <id>` prints a one-line JSON pin.
4. The teacher pastes that line as `LIVE_RELEASE` (Project Settings → Script Properties). It takes effect on the next page load; no redeploy.

The browser refuses any file whose bytes don't match the pinned hash (Subresource
Integrity), so a push to this repo — or a compromised CDN — can't change what students run.
No pin, or a malformed one, means the game shows "not released" rather than loading anything unchecked.
GitHub Pages serves releases; jsDelivr at the pinned commit is the fallback.

**Never push to a pinned release folder. Nothing changes on days students are playing.**

To roll back: paste an older pin, or paste the previous `Index.html` (FM project files,
`claude/long-run/live-2026-11-18/Index.html`).
