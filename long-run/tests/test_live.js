// Baseline: the LIVE channel (today's game, moved to GitHub unchanged) loads
// through the new shell and plays 15 years end to end.
'use strict';
const { makeServer, openGame } = require('./sim');
const { playGame, cardBtn, moneyNum } = require('./play');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

(async () => {
  const server = makeServer();

  // 1. shell loads the live build from Pages
  server.setEmail('saver.bot@excelcenteraz.org');
  let g = await openGame(server);
  ok(!!g.doc.querySelector('#app .lr-card'), 'shell boots the live build');
  ok(g.loader.loaded.join(',') === 'live/styles.css,live/data.js,live/persistence.js,live/game.js', 'loads styles, data, persistence, game in order from Pages: ' + g.loader.loaded.join(','));
  const betaTag = () => Array.from(g.doc.querySelectorAll('body > div')).some(d => d.textContent === 'BETA');
  ok(!betaTag(), 'no BETA tag on live');

  // header-vs-card mismatch probe (known bug)
  const mism = [];
  const checks = {
    quarter(g) {
      const head = moneyNum(g.doc.querySelector('.lr-port-val').textContent);
      const nw = Array.from(g.doc.querySelectorAll('.lr-standing > div')).find(d => /Net worth/.test(d.textContent));
      const cardV = moneyNum(nw.querySelector('strong').textContent);
      if (Math.abs(head - cardV) > 1) mism.push(`Y${g.G().year + 1} ${g.G().phase}: header ${head} vs card ${cardV}`);
    },
    verify() {}
  };
  const saver = await playGame(g, null, checks);
  console.log('  saver final:', JSON.stringify(saver));
  ok(Math.abs(saver['What you actually did'] - saver["If you'd left it all in savings"]) <= 1, 'pure saver lands on the savings benchmark');
  ok(g.errors.length === 0, 'no page errors (' + g.errors.length + ')');
  console.log('  header/card mismatches seen:', mism.length, mism.slice(0, 3));

  // 2. indexer
  server.setEmail('index.bot@excelcenteraz.org');
  g = await openGame(server);
  const idx = await playGame(g, async (g) => {
    for (let k = 0; k < 6; k++) {
      const b = cardBtn(g, 'Index 5', /^\+\$1000$/);
      if (!b || b.disabled) break;
      b.click(); await g.settle(3);
    }
  });
  console.log('  indexer final:', JSON.stringify(idx));
  ok(idx['What you actually did'] > idx["If you'd left it all in savings"], 'indexer beats saving');
  ok(g.errors.length === 0, 'no page errors (' + g.errors.length + ')');

  // 3. Pages blocked -> jsDelivr fallback
  server.setEmail('fallback.bot@excelcenteraz.org');
  g = await openGame(server, { blockPages: true });
  ok(!!g.doc.querySelector('#app .lr-card'), 'falls back to jsDelivr when Pages is blocked: ' + g.loader.loaded.join(','));

  // 4. beta channel
  server.setEmail('beta.bot@excelcenteraz.org');
  g = await openGame(server, { params: { beta: '1' } });
  ok(g.loader.loaded[0] === 'beta/styles.css', '?beta=1 loads the beta build');
  ok(Array.from(g.doc.querySelectorAll('body > div')).some(d => d.textContent === 'BETA'), 'BETA tag shows on beta');

  // 5. the OLD Index.html still works too (rollback path)
  server.setEmail('rollback.bot@excelcenteraz.org');
  g = await openGame(server, { indexFile: '/home/claude/longrun-src/Index.html' });
  ok(!!g.doc.querySelector('#app .lr-card'), 'old Index.html (rollback) still boots');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
