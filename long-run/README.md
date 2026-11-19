# The Long Run — game client

The Long Run runs as a Google Apps Script web app. The Apps Script project holds the
**shell, the server and the release pin**; the game files students run live here, frozen and hash-pinned.

| Where | What | Who changes it |
|---|---|---|
| Apps Script `Index.html` | Shell: injects the save + the pinned release, loads the files with hash checks | Pasted once (copy: `apps-script/Index.html`) |
| Apps Script `Release.gs` | **The pin**: release id, commit, SHA-384 of every file — hard-coded | Pasted per release (copy: `apps-script/Release.gs`) |
| Apps Script `Code.gs`, `Market.gs` | Login, saves, phase machine (hardened Nov 2026); future prices | Apps Script only — **neither goes in this public repo** |
| `releases/<id>/` | Frozen builds. Never edited after pinning; a change = a new id | `tools/make_release.py` |
| `beta/` | Working copy the next release is frozen from. **Nothing loads it.** | Push freely |
| `live/` | Old unpinned channel for the v1 shell; delete once shell v3 is deployed | — |
| `fonts/` | OFL licenses for the fonts embedded in `styles.css` | — |

## Releasing
1. Build in `beta/`, run `tests/` (harness + real-Chrome SRI check).
2. `python3 tools/make_release.py beta <id>`; commit and push the folder.
3. `python3 tools/make_release.py --pin <id>`; put that JSON in `apps-script/Release.gs`.
4. The teacher pastes Release.gs, plays it on `/dev` (the editor's test link: runs what's saved, students don't see it),
   then Deploy → Manage deployments → New version. Students get it only at that step.
   Rollback = Manage deployments → pick the previous version.

The browser refuses any file whose bytes don't match the pinned hash (Subresource Integrity). Fonts are
inlined in `styles.css`, so its hash covers them; the page fetches nothing else. A push to this repo, or a
compromised CDN, can't change what anyone runs. No pin, or a damaged one, shows "not released" (fails closed).
GitHub Pages serves releases; jsDelivr at the pinned commit is the fallback.

**Never push to a pinned release folder. Nothing changes on days students are playing.**
