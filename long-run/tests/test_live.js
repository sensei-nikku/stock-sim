// The shell: pinned releases (Script Property LIVE_RELEASE), teacher-only beta,
// fail-closed without a pin, jsDelivr fallback, rollback.
'use strict';
const { makeServer, openGame } = require('./sim');
const { playGame, cardBtn, moneyNum } = require('./play');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

(async () => {
  const server = makeServer();
  const CLASSIC = '2026-11-18-classic', V2 = '2026-11-18-v2';
  const betaTag = (g) => Array.from(g.doc.querySelectorAll('body > div')).some(d => d.textContent === 'BETA');

  // 1. pinned release: the shell loads releases/<id>/ from Pages, in order
  server.useRelease(CLASSIC);
  server.setEmail('saver.bot@excelcenteraz.org');
  let g = await openGame(server);
  ok(!!g.doc.querySelector('#app .lr-card'), 'shell boots the pinned release');
  ok(g.loader.loaded.join(',') === ['styles.css', 'data.js', 'persistence.js', 'game.js'].map(f => 'releases/' + CLASSIC + '/' + f).join(','), 'loads styles, data, persistence, game in order from releases/' + CLASSIC + ': ' + g.loader.loaded.join(','));
  ok(!betaTag(g), 'no BETA tag on the release');
  const saver = await playGame(g, null, null);
  ok(Math.abs(saver['What you actually did'] - saver["If you'd left it all in savings"]) <= 1 && saver['What you actually did'] === 69201, 'classic release: pure saver lands on $69,201');
  ok(g.errors.length === 0, 'no page errors (' + g.errors.length + ')');

  // 2. indexer on the classic release
  server.setEmail('index.bot@excelcenteraz.org');
  g = await openGame(server);
  const idx = await playGame(g, async (g) => {
    for (let k = 0; k < 6; k++) { const b = cardBtn(g, 'Index 5', /^\+\$1000$/); if (!b || b.disabled) break; b.click(); await g.settle(3); }
  });
  ok(idx['What you actually did'] > idx["If you'd left it all in savings"], 'indexer beats saving');

  // 3. Pages blocked -> jsDelivr at the pinned commit
  server.setEmail('fallback.bot@excelcenteraz.org');
  g = await openGame(server, { blockPages: true });
  ok(!!g.doc.querySelector('#app .lr-card') && g.loader.loaded.every(x => x.includes('(jsdelivr)') && x.startsWith('releases/')), 'falls back to jsDelivr at the pinned commit when Pages is blocked: ' + g.loader.loaded.join(','));

  // 4. ?beta=1 is teacher-only
  server.setEmail('curious.student@excelcenteraz.org');
  g = await openGame(server, { params: { beta: '1' } });
  ok(g.loader.loaded[0] === 'releases/' + CLASSIC + '/styles.css' && !betaTag(g), 'a student adding ?beta=1 still gets the approved release');
  server.setEmail(server.ctx.TEACHERS[0]);
  g = await openGame(server, { params: { beta: '1' } });
  ok(g.loader.loaded[0] === 'beta/styles.css' && betaTag(g), 'the teacher with ?beta=1 gets the beta build and the BETA tag');

  // 5. fails closed with no pin, or a malformed one
  server.useRelease(null);
  server.setEmail('saver.bot@excelcenteraz.org');
  g = await openGame(server);
  ok(/hasn't been released yet/.test(g.text()) && g.loader.loaded.length === 0, 'no LIVE_RELEASE: "not released" and nothing loads');
  server.useRelease(CLASSIC, { raw: '{"id":"x","sha":"abc","files":{}}' });
  g = await openGame(server);
  ok(/hasn't been released yet/.test(g.text()) && g.loader.loaded.length === 0, 'malformed LIVE_RELEASE: same, nothing loads');
  server.useRelease(CLASSIC, { raw: '{"id":"x</script><script>alert(1)//","sha":"' + 'a'.repeat(40) + '","files":{}}' });
  g = await openGame(server);
  ok(/hasn't been released yet/.test(g.text()) && g.errors.length === 0, 'a pin with markup in it is rejected, not inlined');

  // 6. switching the pin switches what students get, no redeploy
  server.useRelease(V2);
  server.setEmail('new.after.switch@excelcenteraz.org');
  g = await openGame(server);
  ok(g.loader.loaded[0] === 'releases/' + V2 + '/styles.css' && /practice round/i.test(g.text()), 'changing LIVE_RELEASE to v2 serves the new version on the next load');

  // 7. the OLD Index.html still works (rollback path)
  server.setEmail('rollback.bot@excelcenteraz.org');
  g = await openGame(server, { indexFile: '/home/claude/longrun-src/Index.html' });
  ok(!!g.doc.querySelector('#app .lr-card'), 'old Index.html (rollback) still boots');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
