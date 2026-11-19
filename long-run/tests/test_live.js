// The shell (pinned releases only, hard-coded in Release.gs) and the Code.gs hardening.
'use strict';
const { makeServer, openGame } = require('./sim');
const { playGame, cardBtn, moneyNum } = require('./play');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }

(async () => {
  const server = makeServer();
  // LR_PROFILE=v3: the v3 server (Code.gs/Market.gs v3) only runs v3 clients, so the classic
  // games and the old-Index rollback are skipped; rollback for v3 = redeploy the previous version.
  const V3 = process.env.LR_PROFILE === 'v3';
  const V2 = process.env.LR_SHIPPED || '2026-11-19-v2', CLASSIC = '2026-11-19-classic';
  const PLAYABLE = V3 ? (process.env.LR_RELEASE || 'dev-v3') : CLASSIC;
  const betaTag = (g) => Array.from(g.doc.querySelectorAll('body > div')).some(d => d.textContent === 'BETA');
  const files = (id) => ['styles.css', 'data.js', 'persistence.js', 'game.js'].map(f => 'releases/' + id + '/' + f).join(',');

  // 1. the Release.gs as shipped (real pin, untouched by the test)
  server.setEmail('first.student@excelcenteraz.org');
  let g = await openGame(server);
  ok(g.loader.loaded.join(',') === files(V2) && /practice round/i.test(g.text()), 'shipped Release.gs: loads ' + V2 + ' in order and the practice round starts');
  ok(!(g.loader.others || []).length, 'no other requests at all (fonts are embedded): ' + (g.loader.others || []).join(', '));

  // 2. classic pin: the old game, money unchanged
  if (!V3) {
  server.useRelease(CLASSIC);
  server.setEmail('saver.bot@excelcenteraz.org');
  g = await openGame(server);
  ok(g.loader.loaded.join(',') === files(CLASSIC), 'classic pin loads ' + CLASSIC);
  const saver = await playGame(g, null, null);
  ok(saver['What you actually did'] === 69201 && saver["If you'd left it all in savings"] === 69201, 'classic: pure saver lands on $69,201');
  ok(g.errors.length === 0, 'no page errors');
  server.setEmail('index.bot@excelcenteraz.org');
  g = await openGame(server);
  const idx = await playGame(g, async (g) => {
    for (let k = 0; k < 6; k++) { const b = cardBtn(g, 'Index 5', /^\+\$1000$/); if (!b || b.disabled) break; b.click(); await g.settle(3); }
  });
  ok(idx['What you actually did'] > idx["If you'd left it all in savings"], 'classic: indexer beats saving');
  }
  server.useRelease(PLAYABLE);

  // 3. jsDelivr at the pinned commit when Pages is blocked
  server.setEmail('fallback.bot@excelcenteraz.org');
  g = await openGame(server, { blockPages: true });
  ok(!!g.doc.querySelector('#app .lr-card') && g.loader.loaded.every(x => x.includes('(jsdelivr)')), 'Pages blocked: same pinned files from jsDelivr');

  // 4. there is no unpinned path any more
  for (const who of ['curious.student@excelcenteraz.org', server.ctx.TEACHERS[0]]) {
    server.setEmail(who);
    g = await openGame(server, { params: { beta: '1' } });
    ok(g.loader.loaded.every(x => x.startsWith('releases/')) && !betaTag(g), (who === server.ctx.TEACHERS[0] ? 'teacher' : 'student') + ' with ?beta=1 still gets only the pinned release');
  }

  // 5. fails closed
  server.setEmail('saver.bot@excelcenteraz.org');
  for (const [label, raw] of [['no pin', undefined], ['damaged pin', '{"id":"x","sha":"abc","files":{}}'],
                              ['pin with markup', { id: 'x</script><script>alert(1)//', sha: 'a'.repeat(40), files: {} }]]) {
    if (raw === undefined) server.useRelease(null); else server.useRelease(PLAYABLE, { raw });
    g = await openGame(server);
    ok(/hasn't been released yet/.test(g.text()) && g.loader.loaded.length === 0 && g.errors.length === 0, label + ': "not released", nothing loads');
  }
  server.useRelease(PLAYABLE);

  // 6. Code.gs hardening
  const C = server.ctx;
  ok(C.doGet().xframe === 'DEFAULT', 'doGet: other sites can no longer frame the game');
  let threw = false; try { C.include('Market'); } catch (e) { threw = true; }
  ok(threw, "include('Market') is refused from the browser");
  if (!V3) ok(/The Long Run — Game\.html/.test(C.include('Game')), "include('Game') still works (rollback Index.html)");
  else { let t2 = false; try { C.include('Game'); } catch (e) { t2 = true; } ok(t2, "v3: include() hands out nothing (old partials deleted)"); }
  server.setEmail('saver.bot@excelcenteraz.org');
  const before = JSON.stringify(server.sheets.Saves.rows.find(r => r[0] === 'saver.bot@excelcenteraz.org'));
  ok(C.resetMe().error === 'not authorized' && JSON.stringify(server.sheets.Saves.rows.find(r => r[0] === 'saver.bot@excelcenteraz.org')) === before, "a student calling resetMe() from the console is refused; their save is untouched");
  server.setEmail('blob.bot@excelcenteraz.org');
  C.boot_('blob.bot@excelcenteraz.org');
  const huge = JSON.stringify({ junk: 'x'.repeat(45000) });
  let r = C.advance(0, 'choose', huge, 'TRADE');
  ok(r.ok === false && /too large/.test(r.error), 'a 45,000-character save is refused');
  r = C.advance(0, 'choose', '[1,2,3]', 'TRADE');
  ok(r.ok === false && /damaged/.test(r.error), 'a save that is not a JSON object is refused');
  r = C.advance(0, 'choose', 'not json', 'TRADE');
  ok(r.ok === false && /damaged/.test(r.error), 'a save that is not JSON is refused');
  ok(server.sheets.Saves.rows.find(r => r[0] === 'blob.bot@excelcenteraz.org')[3] === 'choose', '...and the refused saves never reached the sheet');
  r = C.advance(0, 'choose', '{}', 'TRADE');
  ok(r.ok === true && r.phase === 'q0', 'a normal save still goes through');
  for (const k in server.cache) delete server.cache[k];          // force a trip to the sheet
  const realGetSheet = C.getSheet_;
  C.getSheet_ = () => { throw new Error('Exception: Service Spreadsheets failed at Code.gs:63 (internal detail)'); };
  r = C.advance(0, 'q0', '{}');
  C.getSheet_ = realGetSheet;
  ok(r.error === 'The game server hit a problem.' && !/Code\.gs|internal/.test(r.error) && server.errorsLogged.some(x => /internal detail/.test(x)), 'server errors: generic message to the browser, details only in the execution log');
  server.setEmail(server.ctx.TEACHERS[0]);
  ok(C.resetMe().ok === true, 'the teacher can still reset their own game');

  // 7. rollback: the OLD Index.html still boots with the hardened Code.gs
  if (!V3) {
  server.setEmail('rollback.bot@excelcenteraz.org');
  g = await openGame(server, { indexFile: '/home/claude/longrun-src/Index.html' });
  ok(!!g.doc.querySelector('#app .lr-card'), 'old Index.html (rollback) still boots');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
