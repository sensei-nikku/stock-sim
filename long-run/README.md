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
   Rollback = Manage deployments → pick the previous version. That restores Code.gs, Market.gs and the pin
   together, which matters: a server and a client only work as a matched pair (v3's 25-year server can't run
   the v2 or classic client), so never roll back by swapping the pin alone.

## Releases
| Id | What |
|---|---|
| `2026-11-19-v3.2` | Same as v3.1 with no era names on screen (no "quiet market", no "long run begins" card, one progress-bar gap after practice). Pair with Market.gs whose Year 10 title is "More of the Same". |
| `2026-11-19-v3.1` | Same as v3, plus the teacher dashboard shows Practice / Year N / Finished. |
| `2026-11-19-v3` | 25 years: 5-year practice (balances carry over) → 5 quiet years → 15-year long run. Start-of-year forecasts, random rumors (Street Tattler), mood + reflection stops, printable report. Needs Code.gs/Market.gs v3. |
| `2026-11-19-v2` | 5-year practice round + 15 years. Needs Code.gs/Market.gs v2. |
| `2026-11-19-classic` | The original 15-year game, fonts embedded. Needs Code.gs/Market.gs v2. |

## Tests
`NODE_PATH=<jsdom> LR_SRC=<folder with the private Code.gs + Market.gs>`, then:
`node tests/test_v3.js` (v3 game, `LR_RELEASE=<id>`), `LR_PROFILE=v3 node tests/test_live.js` (shell + server hardening),
`python3 tests/test_sri_chrome.py <id>` (real Chrome), `node tests/shots_v3.js` + `python3 tests/shots_v3.py` (screenshots).

The browser refuses any file whose bytes don't match the pinned hash (Subresource Integrity). Fonts are
inlined in `styles.css`, so its hash covers them; the page fetches nothing else. A push to this repo, or a
compromised CDN, can't change what anyone runs. No pin, or a damaged one, shows "not released" (fails closed).
GitHub Pages serves releases; jsDelivr at the pinned commit is the fallback.

**Never push to a pinned release folder. Nothing changes on days students are playing.**
