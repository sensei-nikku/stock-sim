// BETA channel: practice round + fixes, through the real shell, real Code.gs/Market.gs.
'use strict';
const { makeServer, openGame } = require('./sim');
const { card, cardBtn, moneyNum } = require('./play');

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const BETA = { params: { beta: '1' } };
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.011 : tol);

function storageOf(g) { const o = {}; const ls = g.w.localStorage; for (let i = 0; i < ls.length; i++) o[ls.key(i)] = ls.getItem(ls.key(i)); return o; }
async function reopen(server, g, extra) {
  const saved = storageOf(g);
  return openGame(server, Object.assign({}, BETA, extra || {}, { seedStorage: saved }));
}
function coach(g) { const c = g.doc.querySelector('.lr-coach p'); return c ? c.textContent : ''; }
function recapText(g) { return Array.from(g.doc.querySelectorAll('.lr-recap')).map(d => d.textContent).join(' | '); }
function dollars(s) { return (s.match(/[+−-]?\$[0-9,]+\.\d\d/g) || []).map(x => Number(x.replace(/[^0-9.]/g, '')) * (/^[−-]/.test(x) ? -1 : 1)); }

async function typeReflection(g, text) {
  const ta = g.doc.querySelector('.lr-reflect-box');
  ta.value = text;
  ta.dispatchEvent(new g.w.Event('input', { bubbles: true }));
  await g.settle(3);
}

// Walk the practice round. y5: 'hold' | 'sell'. Returns per-year recap texts.
async function playPractice(g, y5, checks) {
  const recaps = [];
  await g.click(/^Start the practice round/);
  for (let y = 0; y < 5; y++) {
    await g.click(/^Start Practice Year/);
    for (let q = 0; q < 4; q++) {
      // locked companies have no buttons at all; the spotlight has only the asked-for one live
      const locked = Array.from(g.doc.querySelectorAll('.lr-lockrow'));
      const live = g.buttons().filter(b => !b.disabled && b.closest('.lr-instr'));
      if (checks) checks.push({ y, q, lockedCount: locked.length, lockedBtns: locked.reduce((n, c) => n + c.querySelectorAll('button').length, 0), liveCount: live.length, nextDisabled: g.btn(/Next quarter|See how|Do what the coach|Make your call/).disabled, pay: g.doc.querySelector('.lr-card .lr-muted').textContent });
      const pulse = g.doc.querySelector('.lr-instr button.lr-pulse:not([disabled])');
      if (pulse) {
        if (y === 4 && q === 1) await g.click(y5 === 'sell' ? /^Sell all$/ : /^Hold$/);
        else { pulse.click(); await g.settle(3); }
      }
      await g.click(/^(Next quarter|See how Practice Year)/);
    }
    recaps.push(recapText(g));
    await g.click(/^(On to Practice Year|Finish the practice round)/);
  }
  const finalV = moneyNum(g.doc.querySelectorAll('.lr-final tr')[1].cells[1].textContent);
  return { recaps, finalV };
}

async function playReal(g, years, strategy, opts) {
  opts = opts || {};
  const mism = [];
  for (let y = 0; y < years; y++) {
    if (g.G().phase === 'choose') await g.click(/^Begin Quarter 1/);
    for (let q = 0; q < 4; q++) {
      const head = moneyNum(g.doc.querySelector('.lr-port-val').textContent);
      const nw = Array.from(g.doc.querySelectorAll('.lr-standing > div')).find(d => /Net worth/.test(d.textContent));
      if (Math.abs(head - moneyNum(nw.querySelector('strong').textContent)) > 1) mism.push(`Y${y + 1}Q${q + 1}`);
      if (strategy) await strategy(g, y, q);
      await g.click(/^(Advance to Q|Close out the year)/);
    }
    // year-end
    const head = moneyNum(g.doc.querySelector('.lr-port-val').textContent);
    const ended = moneyNum(g.doc.querySelector('.lr-gl-end td:last-child').textContent);
    if (Math.abs(head - ended) > 1) mism.push(`Y${y + 1} verify header ${head} vs ended ${ended}`);
    if (opts.onVerify) await opts.onVerify(g, y);
    if (!g.doc.querySelector('.lr-emotion-on')) await g.click(/^Calm$/);
    if (g.doc.querySelector('.lr-reflect-box')) {
      if (g.doc.getElementById('lr-gate').disabled) await typeReflection(g, 'Year ' + (y + 1) + ': I kept most of it in savings because the news scared me a bit.');
    } else {                                          // live build: paper-journal confirm button
      const r = g.btn(/I've written my reflection/); if (r) { r.click(); await g.settle(3); }
    }
    await g.click(/^(On to Year|See your final results)/);
  }
  return mism;
}

(async () => {
  const server = makeServer();

  // ── 1. brand-new student: practice round, HOLD at the ShopRight bump ──────────
  console.log('\n[1] new student, practice round (hold)');
  server.setEmail('new.student@excelcenteraz.org');
  let g = await openGame(server, BETA);
  ok(/practice round/i.test(g.text()), 'a new student lands on the practice-round welcome');
  ok(!g.btn(/Skip practice/), 'students get no skip button');
  const checks = [];
  // mid-way reload: play into Practice Year 2, reopen, confirm we resume in place
  await g.click(/^Start the practice round/);
  await g.click(/^Start Practice Year/);
  await g.click(/^\+\$100$/);
  ok(/You now own 1\.09 shares/.test(coach(g)), 'Y1Q1 coach confirms the buy (1.09 shares): ' + coach(g).slice(0, 60));
  await g.click(/^Next quarter/);
  ok(/\$80/.test(coach(g)) && g.btn(/^Sell all$/).classList.contains('lr-pulse'), 'Y1Q2: MedCo slides to $80, Sell all is the pulsing button');
  ok(g.btn(/^\+\$100$/).disabled && g.btn(/^\+\$200$/).disabled, 'Y1Q2: buy buttons are locked while the coach asks for Sell all');
  ok(g.btn(/Do what the coach/).disabled, 'Y1Q2: Next is locked until the student acts');
  g.btn(/^\+\$100$/).click(); await g.settle(3);   // wrong (disabled) button: nothing should happen
  ok(/\$80/.test(coach(g)), 'tapping a locked button does nothing');
  const before = g.text();
  g = await reopen(server, g);
  ok(/Practice Year 1 · Quarter 2/.test(g.text()) && /\$80/.test(coach(g)), 'reload mid-practice resumes on the same quarter');
  // finish the round from here
  await g.click(/^Sell all$/);
  ok(/86\.96/.test(coach(g)) && /13\.04/.test(coach(g)), 'Y1Q2 after-text: got back $86.96, $13.04 loss locked in');
  await g.click(/^Next quarter/);
  await g.click(/^\+\$200$/); await g.click(/^Next quarter/);
  await g.click(/^\+\$100$/); await g.click(/^See how Practice Year 1/);
  const y1 = recapText(g);
  ok(/86\.96/.test(y1) && /13\.04/.test(y1) && /95\.65/.test(y1) && /382\.51/.test(y1) && /−\$17\.49/.test(y1), 'Y1 recap numbers: sold $86.96, lost $13.04, holding would be $95.65, year $382.51 (−$17.49)');
  ok(/did the business change, or just the headline/.test(y1), 'Y1 recap rule present');
  await g.click(/^On to Practice Year 2/);
  // Y2..Y5 via the walker (it starts at "Start the practice round", so drive manually)
  const rec = [];
  for (let y = 1; y < 5; y++) {
    await g.click(/^Start Practice Year/);
    for (let q = 0; q < 4; q++) {
      const locked = Array.from(g.doc.querySelectorAll('.lr-lockrow'));
      checks.push({ y, q, lockedBtns: locked.reduce((n, c) => n + c.querySelectorAll('button').length, 0), lockedCount: locked.length });
      const pulse = g.doc.querySelector('.lr-instr button.lr-pulse:not([disabled])');
      if (y === 1 && q === 2) ok(/3\.28/.test(coach(g)) && /\+\$3\.28 in dividends/.test(g.text()), 'Y2Q3: TrustBank dividend of $3.28 shows in coach and paycheck line');
      if (y === 4 && q === 1) {
        ok(!!g.btn(/^Hold$/) && !g.btn(/^Hold$/).disabled && !g.btn(/^Sell all$/).disabled, 'Y5Q2: both Hold and Sell all are live (student decides)');
        await g.click(/^Hold$/);
      } else if (pulse) { pulse.click(); await g.settle(3); }
      await g.click(/^(Next quarter|See how Practice Year)/);
    }
    rec.push(recapText(g));
    await g.click(/^(On to Practice Year|Finish the practice round)/);
  }
  ok(checks.every(c => c.lockedCount === 4 && c.lockedBtns === 0), 'every practice quarter: 4 companies locked with no buttons');
  ok(/3\.28/.test(rec[0]) && /\$60 to \$65/.test(rec[0]), 'Y2 recap: $3.28 dividends, $60 → $65');
  ok(/120\.00/.test(rec[1]) && /\+\$20\.00/.test(rec[1]) && /175\.00/.test(rec[1]) && /−\$25\.00/.test(rec[1]), 'Y3 recap: calm buy $120.00 (+$20.00), hype buy $175.00 (−$25.00)');
  ok(/136\.84/.test(rec[2]) && /157\.89/.test(rec[2]) && /−\$42\.11/.test(rec[2]), 'Y4 recap: rumor buy fell to $136.84, now $157.89 (−$42.11)');
  ok(/held/.test(rec[3]) && /222\.22/.test(rec[3]) && /2\.78/.test(rec[3]), 'Y5 recap (held): $222.22 + $2.78 dividend');
  const finalHold = moneyNum(g.doc.querySelectorAll('.lr-final tr')[1].cells[1].textContent);
  ok(near(finalHold, 2265.88), 'practice ends at $2,265.88 when held (hand calc): ' + finalHold);
  ok(/Five things to carry/.test(g.text()), 'final screen lists the five rules');

  // reload on the final screen before starting: still on final, not restarted
  g = await reopen(server, g);
  ok(/You're ready/.test(g.text()), 'reload on the final practice screen stays there');
  await g.click(/^Start the real game/);
  ok(/How the real game works/.test(g.text()) && /Start of Year 1/.test(g.text()), 'real Year 1 opens with the "How the real game works" guide');
  // reload after finishing practice but BEFORE the first Advance: no practice again
  g = await reopen(server, g);
  ok(/Start of Year 1/.test(g.text()) && !/practice round/i.test(g.text()), 'finished practice is remembered in this browser before the first Advance');

  // ── 2. real game: saver plays 15 years; fixes check ────────────────────────────
  console.log('\n[2] real game, 15 years, typed reflections');
  let y1Hindsight = '';
  const mism = await playReal(g, 15, null, {
    onVerify: async (g, y) => {
      if (y === 0) {
        y1Hindsight = (g.doc.querySelector('.lr-journal') || { textContent: '' }).textContent;
        ok(/What your investments did/.test(g.text()) && !/What the market did/.test(g.text()), 'ledger says "What your investments did"');
        ok(/Year in Review/.test(g.text()) && !/Verify Your Tracker/.test(g.text()), 'phase label is "Year in Review"');
        ok(!/in your journal/i.test(g.text()), 'no "in your journal" wording');
        await g.click(/^Calm$/);
        const gate = () => g.doc.getElementById('lr-gate');
        ok(gate().disabled, 'year-end gate locked with no reflection');
        await typeReflection(g, 'too short to count');
        ok(gate().disabled && /4 of 8 words/.test(g.text()), 'a 4-word reflection keeps the gate locked (shows 4 of 8)');
        await typeReflection(g, 'I saved everything because I did not trust the market yet.');
        ok(!gate().disabled, 'an 11-word reflection unlocks the gate');
        await g.click(/^Anxious$/);
        ok(g.doc.querySelector('.lr-reflect-box').value.startsWith('I saved everything'), 'changing the feeling keeps the typed reflection');
      }
    }
  });
  ok(/rose 8%/.test(y1Hindsight), 'Y1 hindsight measures from last year\'s close: "rose 8%" — got: ' + y1Hindsight.slice(0, 120));
  ok(mism.length === 0, 'header matches the screen every quarter and at every year-end (' + mism.length + ' mismatches) ' + mism.slice(0, 3).join('; '));
  const fin = Object.fromEntries(Array.from(g.doc.querySelectorAll('.lr-final tr')).map(tr => [tr.cells[0].textContent.trim(), moneyNum(tr.cells[1].textContent)]));
  ok(fin['What you actually did'] === 69201 && fin["If you'd left it all in savings"] === 69201, 'saver still lands on $69,201 — real-game money unchanged: ' + JSON.stringify(fin));
  ok(near(moneyNum(g.doc.querySelector('.lr-port-val').textContent), fin['What you actually did'], 1), 'done-screen header equals the final result');
  const blob = JSON.parse(server.sheets.Saves.rows.find(r => r[0] === 'new.student@excelcenteraz.org')[5]);
  ok(blob.tutorialDone === true && blob.tutorial && near(blob.tutorial.endValue, 2265.88) && blob.tutorial.y5 === 'hold', 'save blob records practice done, $2,265.88, held');
  ok(blob.reflections.length === 15 && blob.reflections[0].startsWith('I saved everything') && blob.reflections[14].startsWith('Year 15:'), '15 typed reflections saved with the game');
  ok(blob.reflected.every(Boolean), 'every year marked reflected');
  console.log('  save blob size:', server.sheets.Saves.rows.find(r => r[0] === 'new.student@excelcenteraz.org')[5].length, 'chars (Sheets cell limit 50,000)');
  ok(g.errors.length === 0, 'no page errors: ' + g.errors.slice(0, 2).join(' / '));

  // ── 3. second student SELLS at the bump; new device after first Advance ─────
  console.log('\n[3] sell at the ShopRight bump; then a fresh browser');
  server.setEmail('seller@excelcenteraz.org');
  g = await openGame(server, BETA);
  const s = await playPractice(g, 'sell');
  ok(/sold at \$39/.test(s.recaps[4]) && /216\.67/.test(s.recaps[4]) && /225\.00/.test(s.recaps[4]) && /8\.33/.test(s.recaps[4]), 'Y5 recap (sold): got $216.67; holding = $225.00, $8.33 more');
  ok(near(s.finalV, 2265.88 - 8.33, 0.02), 'practice ends $8.33 lower when sold: ' + s.finalV);
  await g.click(/^Start the real game/);
  await g.click(/^Begin Quarter 1/);
  g = await openGame(server, BETA);   // fresh browser, empty localStorage
  ok(!/practice round/i.test(g.text()) && /Year 1 · Quarter 1/.test(g.text()), 'a different browser skips practice once the first Advance has saved it');

  // ── 4. a student already mid-game (old save) never sees practice ─────────────
  console.log('\n[4] existing save mid-game');
  server.setEmail('veteran@excelcenteraz.org');
  g = await openGame(server, { /* live */ });
  await playReal(g, 2, null);                    // two years on the LIVE build (old save shape)
  g = await openGame(server, BETA);
  ok(/Start of Year 3/.test(g.text()) && !/practice round/i.test(g.text()), 'a Year-3 save from the old build opens straight into Year 3 on beta');
  await playReal(g, 1, null);
  ok(g.errors.length === 0 && /Start of Year 4/.test(g.text()), 'old save keeps playing on beta without errors');

  // ── 5. indexer: money path + network failure mid-quarter ──────────────────────
  console.log('\n[5] indexer + a dropped connection');
  server.setEmail('index.beta@excelcenteraz.org');
  const failNext = [];
  g = await openGame(server, Object.assign({ failNext }, BETA));
  await g.click(/^Start the practice round/);
  g.w.eval('TP.i = TUT_STEPS.length - 1; tutSave(TP); render();');
  await g.click(/^Start the real game/);
  await g.click(/^Begin Quarter 1/);
  const b = cardBtn(g, 'Index 5', /^\+\$1000$/); b.click(); await g.settle(3);
  failNext.push('advance');
  await g.click(/^Advance to Q2/);
  ok(/press the button again/.test(g.text()) && /Quarter 1/.test(g.text()), 'a dropped connection keeps a "press the button again" message and stays on Quarter 1');
  ok(g.G().hys < 1, 'after the rollback the $1,000 is still invested (savings ~$0)');
  await g.click(/^Advance to Q2/);
  ok(/Quarter 2/.test(g.text()) && !/press the button again/.test(g.text()), 'pressing Advance again goes through and clears the message');
  ok(g.G().hys > 1000 && g.G().hys < 1100, 'exactly one Q2 paycheck credited after the retry (savings ' + g.G().hys.toFixed(2) + ')');
  const buyIdx = async (g) => { for (let k = 0; k < 6; k++) { const bb = cardBtn(g, 'Index 5', /^\+\$1000$/); if (!bb || bb.disabled) break; bb.click(); await g.settle(2); } };
  for (let q = 1; q < 4; q++) { await buyIdx(g); await g.click(/^(Advance to Q|Close out the year)/); }
  await g.click(/^Calm$/);
  await typeReflection(g, 'I put every paycheck into the index fund this year.');
  await g.click(/^On to Year 2/);
  await playReal(g, 14, async (g) => buyIdx(g));
  const fi = Object.fromEntries(Array.from(g.doc.querySelectorAll('.lr-final tr')).map(tr => [tr.cells[0].textContent.trim(), moneyNum(tr.cells[1].textContent)]));
  console.log('  indexer final:', JSON.stringify(fi));
  ok(fi['What you actually did'] > fi["If you'd left it all in savings"], 'indexer beats saving on beta');
  ok(g.errors.length === 0, 'no page errors on the indexer run');
  ok(true, 'indexer finished all 15 years');

  // ── 6. teacher view ────────────────────────────────────────────────────────────
  console.log('\n[6] teacher');
  server.setEmail('nicholas.inoue@excelcenteraz.org');
  g = await openGame(server, BETA);
  await g.settle(30);
  ok(/Teacher panel/.test(g.text()), 'teacher sees the panel');
  ok(/Reflections/.test(g.text()) && !!g.btn(/^Read 15$/), 'dashboard has a Reflections column (new.student: Read 15)');
  await g.click(/^Read 15$/);
  ok(/I saved everything because I did not trust the market yet/.test(g.doc.body.textContent) && /Practice round: finished at \$2,266/.test(g.doc.body.textContent), 'Read shows the typed reflections and the practice result');
  g.doc.querySelector('.lr-modal-x').click();
  await g.click(/Preview as student/);
  ok(/practice round/i.test(g.text()) && !!g.btn(/Skip practice/), 'teacher preview starts the practice round, with a teacher-only Skip');
  await g.click(/Skip practice/);
  ok(/Start of Year 1/.test(g.text()), 'Skip goes straight to the real Year 1');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
