# The Long Run — game client

The Long Run runs as a Google Apps Script web app. Since Nov 2026 the Apps Script
project is only a **shell plus the server**; the game code students run lives here.

| Where | What | Who edits |
|---|---|---|
| Apps Script `Index.html` | Shell: injects the student's save, then loads the files below | Pasted once (copy in `apps-script/Index.html`) |
| Apps Script `Code.gs` | Login, saves (the Saves sheet), the phase machine | Apps Script only |
| Apps Script `Market.gs` | Future prices, news, rumors | Apps Script only — **never commit it here; this repo is public** |
| `live/` | What students get from the normal link | Push here only after testing in `beta/` |
| `beta/` | Test build — add `?beta=1` to the web-app link | Push freely |
| `docs/` | Specs | — |

Each channel holds `styles.css`, `data.js`, `persistence.js`, `game.js` (loaded in that order).
GitHub Pages serves them; jsDelivr is the fallback. Changes show up within about 10 minutes.

**Rule: nothing gets pushed to `live/` on days students are playing.**

The old `Styles`, `Data`, `Persistence` and `Game` files still sit in the Apps Script
project but are no longer loaded. To roll back, paste the previous `Index.html` (in the
FM project files, `claude/long-run/live-2026-11-18/Index.html`) back over the shell.
