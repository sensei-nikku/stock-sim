# Tests

Headless play-throughs: the real `Code.gs` + `Market.gs` run in Node with stubbed Google
services, and the real Apps Script shell loads `live/` or `beta/` in jsdom.

Market.gs is not in this repo (it holds the future prices), so point `LR_SRC` at a folder
holding `Code.gs`, `Market.gs` and the old `.html` partials:

    npm install jsdom@24
    LR_SRC=/path/to/apps-script-files node test_live.js
    LR_SRC=/path/to/apps-script-files node test_beta.js
