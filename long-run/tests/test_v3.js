// v3: 25-year game (practice 1-5 carries over, quiet market 6-10, long run 11-25),
// forecasts, rumors, reflections, report. Real Code.gs v3 + Market.gs v3 (LR_SRC).
'use strict';
const { makeServer, openGame } = require('./sim');
const { cardBtn, moneyNum } = require('./play');
const REL = process.env.LR_RELEASE || 'dev-v3';

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) { pass++; console.log('  ok   ' + msg); } else { fail++; console.log('  FAIL ' + msg); } }
const near = (a, b, tol) => Math.abs(a - b) <= (tol == null ? 0.011 : tol);
const text = (g) => g.text();
// nothing on screen may announce what kind of market is coming
const SPOILER = /quiet (market|years|ones)|long run begins|the long run \u00B7|get(s)? lou(d|der)|calm before|years 6\u201310|years 11\u201325/i;
let spoilers = [];
function scan(g, where) { const m = (g.doc.body.textContent || '').match(SPOILER); if (m) spoilers.push(where + ': ' + m[0]); }
async function type(g, sel, s) { const ta = g.doc.querySelector(sel); ta.value = s; ta.dispatchEvent(new g.w.Event('input', { bubbles: true })); await g.settle(3); }

// Walk the practice round with every stop answered. y5: 'hold' | 'sell'.
async function playPractice(g, y5, probe) {
  await g.click(/^Start the practice round/);
  for (let y = 0; y < 5; y++) {
    await g.click(/^Start Practice Year/);
    for (let q = 0; q < 4; q++) {
      const pulse = g.doc.querySelector('.lr-instr button.lr-pulse:not([disabled])');
      if (pulse) {
        if (y === 4 && q === 1) await g.click(y5 === 'sell' ? /^Sell all$/ : /^Hold$/); else { pulse.click(); await g.settle(3); }
        // after a move: Next is locked until a feeling is tapped
        if (probe && y === 0 && q === 0) probe.afterLocked = g.btn(/Tap how you feel first/) && g.btn(/Tap how you feel first/).disabled;
        await g.click(/^Anxious$/);
      }
      await g.click(/^(Next quarter|See how Practice Year)/);
    }
    if (probe && y === 0) probe.recapLocked = g.doc.getElementById('lr-tut-gate').disabled;
    await g.click(/^Calm$/);
    if (probe && y === 0) probe.recapStillLocked = g.doc.getElementById('lr-tut-gate').disabled;
    await type(g, '.lr-reflect-box', 'Practice year ' + (y + 1) + ' taught me to slow down before I react.');
    await g.click(/^(On to Practice Year|Finish the practice round)/);
  }
}

// One real year. strategy(g, q) runs on each quarter screen. Answers rumors as they pop.
async function playYear(g, strategy, log) {
  scan(g, 'Y' + (g.G().year + 6) + ' open');
  if (g.G().phase === 'choose') await g.click(/^Begin Quarter 1/);
  for (let q = 0; q < 4; q++) {
    if (!/^q[0-3]$/.test(g.G().phase)) throw new Error('expected a quarter, got ' + g.G().phase);
    scan(g, 'Y' + (g.G().year + 6) + ' Q' + (q + 1));
    let guard = 0;
    while (g.doc.querySelector('.lr-modal-backdrop .lr-rumor') && guard++ < 5) {
      if (log) {
        const before = g.G().phase;
        g.btn(/^(Advance to Q|Close out the year)/).click(); await g.settle(5);       // must NOT advance past an open rumor
        log.blockedAdvance = (log.blockedAdvance || 0) + (g.G().phase === before ? 1 : 0);
        log.rumorsSeen = (log.rumorsSeen || 0) + 1;
      }
      await g.click(/^Anxious$/);
    }
    if (log && g.doc.querySelector('.lr-rumorupdates')) log.updates = (log.updates || 0) + 1;
    if (strategy) await strategy(g, q);
    await g.click(/^(Advance to Q|Close out the year)/);
  }
  if (g.G().phase !== 'verify') throw new Error('expected verify, got ' + g.G().phase);
  scan(g, 'Y' + (g.G().year + 6) + ' review');
  if (log) {
    const t = text(g);
    log.verify = log.verify || [];
    log.verify.push({ forecasts: /The forecasts vs\. your market/.test(t), rumors: /Rumors this year/.test(t), stories: /What actually happened/.test(t),
                      header: moneyNum(g.doc.querySelector('.lr-port-val').textContent), ended: moneyNum(g.doc.querySelector('.lr-gl-end td:last-child').textContent) });
  }
  await g.click(/^Calm$/);
  await type(g, '.lr-reflect-box', 'Year ' + (g.G().year + 6) + ': I mostly held on and watched the rumors come and go.');
  await g.click(/^(On to Year|See your final results)/);
}

(async () => {
  const server = makeServer();
  server.useRelease(REL);
  const C = server.ctx;

  // ── 1. practice with stops, then carry-over ──────────────────────────────
  console.log('\n[1] practice round: stops, carry-over into Year 6');
  server.setEmail('v3.student@excelcenteraz.org');
  let g = await openGame(server);
  ok(/25 years/.test(text(g)) && /practice round/i.test(text(g)), 'welcome says 25 years and starts the practice round');
  const probe = {};
  await playPractice(g, 'hold', probe);
  scan(g, 'practice final');
  ok(probe.afterLocked === true, 'after each forced move, Next stays locked until a feeling is tapped');
  ok(probe.recapLocked === true && probe.recapStillLocked === true, 'each practice recap needs a feeling AND a sentence before moving on');
  ok(/You keep it/.test(text(g)) && /Year 6/.test(text(g)), 'final practice screen: "you keep it", on to Year 6');
  await g.click(/^On to Year 6/);
  const G0 = g.G();
  ok(/Welcome to the live market/.test(text(g)) && /Start of Year 6/.test(text(g)) && /Live market/.test(text(g)), 'Year 6 opens: "Live market", no era name');
  ok(near(G0.startStake, 2265.88, 0.02) && near(G0.hys, 702.86, 0.02), 'carry-over: start stake $2,265.88, savings $702.86 (the practice result)');
  ok(['MED', 'TBK', 'NVT', 'PPK', 'SHP'].every(t => G0.lots[t].length === 1 && G0.lots[t][0].yr === 0), 'every practice holding carried over as a long-term lot');
  ok(near(moneyNum(g.doc.querySelector('.lr-port-val').textContent), 2266, 1), 'header shows the carried portfolio ($2,266)');
  ok(near(G0.saverHys, G0.startStake) && near(G0.dcaUnits * 100, G0.startStake), 'both comparison lines start from the same stake');
  ok(/This year's forecasts/.test(text(g)) && g.doc.querySelectorAll('.lr-said').length === 5, 'Year 6 shows 5 forecasts with a direction-and-size tag');
  ok(G0.practice && G0.practice.recaps[0].text.startsWith('Practice year 1') && G0.practice.moods.y0 === 'Calm', 'practice reflections and moods are kept in the save');

  // ── 2. play all 20 market years ──────────────────────────────────────────
  console.log('\n[2] 20 market years');
  const log = {};
  for (let y = 0; y < 20; y++) {
    if (y === 5) ok(/Start of Year 11/.test(text(g)) && /Before the market opens/.test(text(g)) && g.doc.querySelectorAll('.lr-seg-break').length === 1, 'Year 11 opens like any other year (no announcement, one gap in the progress bar: after practice)');
    await playYear(g, null, log);
  }
  ok(g.G().phase === 'done' && /25 years later/.test(text(g)), 'finishes at "25 years later"');
  scan(g, 'final'); g.doc.querySelector('.lr-modal-backdrop') || null;
  ok(/\$82,000/.test(text(g)), 'final screen counts $82,000 put in ($2,000 practice + $80,000 market)');
  ok(log.rumorsSeen > 0 && log.blockedAdvance === log.rumorsSeen, `rumors popped up (${log.rumorsSeen}) and Advance was blocked until each was answered`);
  ok(log.updates > 0, 'rumor updates (true/false) appeared the following quarter (' + log.updates + ')');
  ok(log.verify.length === 20 && log.verify.every(v => v.forecasts && v.rumors && v.stories), 'every year-end shows forecasts vs. your market, rumors, and what actually happened');
  ok(log.verify.every(v => Math.abs(v.header - v.ended) <= 1), 'header matches "Ended with" at every year-end');
  const st = JSON.parse(server.sheets.Saves.rows.find(r => r[0] === 'v3.student@excelcenteraz.org')[5]);
  ok(st.ver === 3 && st.valueHistory.length === 20 && st.saverHistory.length === 20 && st.reflections.length === 20, 'save: version 3, 20 years of values, benchmarks and reflections');
  ok(st.rumorLog.length === log.rumorsSeen && st.rumorLog.every(r => r.mood === 'Anxious'), 'every rumor is logged with its truth and the feeling picked');
  const blobLen = server.sheets.Saves.rows.find(r => r[0] === 'v3.student@excelcenteraz.org')[5].length;
  ok(blobLen < 40000, 'finished save is ' + blobLen + ' characters (limit 40,000)');
  ok(g.errors.length === 0, 'no page errors: ' + g.errors.slice(0, 2).join(' / '));

  // ── 3. the report ──────────────────────────────────────────────────────────
  console.log('\n[3] report');
  await g.click(/^Print my report/);
  const rep = text(g);
  scan(g, 'report');
  ok(spoilers.length === 0, 'no screen names the coming market (quiet/loud/long run): ' + spoilers.slice(0, 3).join(' | '));
  ok(/my report/.test(rep) && /Finished all 25 years/.test(rep) && /v3\.student@excelcenteraz\.org/.test(rep), 'report: title, email, finished');
  ok(/Practice year 1 taught me/.test(rep) && /Year 25: I mostly held/.test(rep), 'report includes practice and market reflections');
  ok(/Rumors that reached me/.test(rep) && /true, \d+ false/.test(rep), 'report lists rumors with true/false counts');
  ok(g.doc.querySelectorAll('.lr-rep-tbl tr').length >= 20, 'report has the year-by-year table');
  await g.click(/Back/);
  ok(/25 years later/.test(text(g)), 'Back returns to the game');

  // ── 4. the server never leaks ahead ───────────────────────────────────────
  console.log('\n[4] reveal policy');
  let leaks = 0, checked = 0;
  for (const em of ['leak.a@excelcenteraz.org', 'leak.b@excelcenteraz.org', 'leak.c@excelcenteraz.org']) {
    for (let y = 0; y < 20; y++) {
      const ch = C.reveal_(em, y, 'choose');
      if (ch.prices || ch.rumors || ch.stories || ch.title || ch.news.some(n => 'miss' in n || 'why' in n)) leaks++;
      for (let q = 0; q < 4; q++) {
        const r = C.reveal_(em, y, 'q' + q); checked++;
        if (r.prices.MED.length !== q + 1 || r.index.length !== q + 1) leaks++;
        if (r.stories || r.title) leaks++;
        if (r.news.some(n => 'miss' in n || 'why' in n)) leaks++;
        (r.rumors || []).forEach(x => { if (x.q > q) leaks++; if (x.q === q && ('truth' in x || 'keep' in x)) leaks++; if (x.q < q && !('truth' in x)) leaks++; });
        if (JSON.stringify(r).includes('"size"') && !JSON.stringify(r.news).includes('"size"')) leaks++;
      }
    }
  }
  ok(leaks === 0, `no future prices, early rumors, early truths, titles, stories or forecast verdicts in ${checked} quarter reveals`);
  // forecasts: calm years miss on size only; wild years can be flat wrong, with a backstory
  let calmBust = 0, calmSize = 0, calmN = 0, wildBust = 0, wildN = 0, noWhy = 0;
  for (let y = 0; y < 20; y++) {
    const news = C.reveal_('any@excelcenteraz.org', y, 'verify').news, wild = C.VOLATILITY[y] >= 0.5;
    news.forEach(n => { if (wild) { wildN++; wildBust += n.miss === 'busted'; } else { calmN++; calmBust += n.miss === 'busted'; calmSize += n.miss === 'size'; }
                        if (n.miss !== 'right' && !n.why) noWhy++; });
  }
  console.log(`  forecasts: calm ${calmSize}/${calmN} wrong size, ${calmBust} wrong way; wild ${wildBust}/${wildN} flat wrong`);
  ok(calmBust === 0 && calmSize >= calmN * 0.35, 'calm years: direction always right, size often wrong');
  ok(wildBust >= 5, 'wild years: some forecasts are flat wrong (' + wildBust + ')');
  ok(noWhy === 0, 'every missed forecast comes with a reason for year end');
  const a1 = JSON.stringify(C.generateMarket_('same@excelcenteraz.org')), a2 = JSON.stringify(C.generateMarket_('same@excelcenteraz.org'));
  ok(a1 === a2, 'a student\'s market is the same every time (reloading never rerolls)');
  const finals = Array.from({ length: 30 }, (_, i) => JSON.stringify(C.generateMarket_('s' + i + '@excelcenteraz.org')[19].MED[3]));
  ok(new Set(finals).size > 1, 'students\' markets diverge through true rumors (' + new Set(finals).size + ' different final MedCo prices across 30 students)');
  const news1 = JSON.stringify(C.reveal_('x@excelcenteraz.org', 9, 'choose').news), news2 = JSON.stringify(C.reveal_('y@excelcenteraz.org', 9, 'choose').news);
  ok(news1 === news2, 'forecasts are the same for the whole class');

  // ── 5. old saves are archived and restarted ───────────────────────────────
  console.log('\n[5] old saves');
  server.sheets.Saves.appendRow(['old.save@excelcenteraz.org', 4, 4, 'verify', 'TRADE', JSON.stringify({ hys: 5000, valueHistory: [1, 2, 3, 4] }), new Date()]);
  server.setEmail('old.save@excelcenteraz.org');
  g = await openGame(server);
  const row = server.sheets.Saves.rows.find(r => r[0] === 'old.save@excelcenteraz.org');
  ok(row[2] === 0 && row[3] === 'choose' && row[5] === '', 'an old-version save restarts at the beginning');
  ok(server.sheets.Archive && server.sheets.Archive.rows.some(r => r[0] === 'old.save@excelcenteraz.org' && r[2] === 4), 'and a copy is kept in the Archive tab');
  ok(/practice round/i.test(text(g)), 'that student starts the practice round');

  // ── 6. an indexer over 25 years ───────────────────────────────────────────
  console.log('\n[6] indexer');
  server.setEmail('v3.indexer@excelcenteraz.org');
  g = await openGame(server);
  await playPractice(g, 'sell');
  await g.click(/^On to Year 6/);
  const buyIdx = async (g) => { for (let k = 0; k < 6; k++) { const b = cardBtn(g, 'Index 5', /^\+\$1000$/); if (!b || b.disabled) break; b.click(); await g.settle(2); } };
  for (let y = 0; y < 20; y++) await playYear(g, buyIdx, null);
  const fin = Object.fromEntries(Array.from(g.doc.querySelectorAll('.lr-final tr')).map(tr => [tr.cells[0].textContent.trim(), moneyNum(tr.cells[1].textContent)]));
  console.log('  indexer final:', JSON.stringify(fin));
  ok(fin['What you actually did'] > fin["If you'd left it all in savings"], 'indexer beats just saving over 25 years');
  ok(g.errors.length === 0, 'no page errors on the indexer run');

  // ── 7. teacher ─────────────────────────────────────────────────────────────
  console.log('\n[7] teacher');
  server.setEmail(C.TEACHERS[0]);
  g = await openGame(server);
  await g.settle(30);
  const trow = Array.from(g.doc.querySelectorAll('.lr-dash tr')).find(tr => /v3\.student/.test(tr.textContent));
  ok(trow && /Finished/.test(trow.textContent), 'dashboard shows a finished student as Finished');
  const rows = Array.from(g.doc.querySelectorAll('.lr-dash tr'));
  const rowOf = (re) => rows.find(tr => re.test(tr.textContent));
  ok(rowOf(/old\.save@/) && /Practice/.test(rowOf(/old\.save@/).textContent), 'dashboard: a student in the practice round shows Practice');
  Array.from(trow.querySelectorAll('button')).find(b => b.textContent === 'Report').click(); await g.settle(5);
  ok(/my report/.test(text(g)) && /v3\.student@excelcenteraz\.org/.test(text(g)) && /Practice year 1 taught me/.test(text(g)), 'teacher can open and print any student\'s report');

  // ── 8. practice progress follows the student to another computer ────────
  console.log('\n[8] switching computers');
  server.setEmail('mover@excelcenteraz.org');
  g = await openGame(server);
  await g.click(/^Start the practice round/);
  for (let y = 0; y < 2; y++) {                       // two practice years on computer A
    await g.click(/^Start Practice Year/);
    for (let q = 0; q < 4; q++) {
      const pulse = g.doc.querySelector('.lr-instr button.lr-pulse:not([disabled])');
      if (pulse) { pulse.click(); await g.settle(3); await g.click(/^Anxious$/); }
      await g.click(/^(Next quarter|See how Practice Year)/);
    }
    await g.click(/^Calm$/);
    await type(g, '.lr-reflect-box', 'On computer A, practice year ' + (y + 1) + ' felt slow but useful to me.');
    await g.click(/^On to Practice Year/);
  }
  await g.settle(20);
  g = await openGame(server);                          // computer B: empty localStorage
  ok(/Start Practice Year 3/.test(text(g)), 'a fresh computer resumes at Practice Year 3 (checkpointed at each recap)');
  await g.click(/^Start Practice Year 3/);
  for (let y = 2; y < 5; y++) {
    if (y > 2) await g.click(/^Start Practice Year/);
    for (let q = 0; q < 4; q++) {
      const pulse = g.doc.querySelector('.lr-instr button.lr-pulse:not([disabled])');
      if (pulse) { pulse.click(); await g.settle(3); await g.click(/^Anxious$/); }
      await g.click(/^(Next quarter|See how Practice Year)/);
    }
    await g.click(/^Calm$/);
    await type(g, '.lr-reflect-box', 'On computer B, practice year ' + (y + 1) + ' made me want to hold.');
    await g.click(/^(On to Practice Year|Finish the practice round)/);
  }
  await g.click(/^On to Year 6/);
  await g.settle(20);
  g = await openGame(server);                          // computer C, before ever pressing Advance
  const Gm = g.G();
  ok(/Start of Year 6/.test(text(g)) && Gm.startStake > 2000 && Gm.startStake === Gm.practice.endValue && !Gm.tp, 'a third computer opens straight at Year 6 with the carried portfolio');
  ok(/computer A, practice year 1/.test(Gm.practice.recaps[0].text) && /computer B, practice year 5/.test(Gm.practice.recaps[4].text), 'reflections from both computers are in the save');
  await g.click(/^Begin Quarter 1/);
  let r = C.savePractice(JSON.stringify({ ver: 3, hys: 999999 }));
  ok(r.ok === false && r.stale && JSON.parse(server.sheets.Saves.rows.find(x => x[0] === 'mover@excelcenteraz.org')[5]).hys !== 999999, 'once the live market starts, the practice checkpoint is refused');
  server.setEmail('blob2@excelcenteraz.org'); C.boot_('blob2@excelcenteraz.org');
  r = C.savePractice(JSON.stringify({ junk: 'x'.repeat(45000) }));
  ok(r.ok === false && /too large/.test(r.error), 'a 45,000-character practice checkpoint is refused');

  // ── 9. rumor: reload while it's open, and a dropped connection ───────────
  console.log('\n[9] rumor edge cases');
  let em = null;
  for (let i = 0; i < 400 && !em; i++) { const e = 'rumor' + i + '@excelcenteraz.org'; if (C.buildYear_(e, 0).rumors.some(x => x.q === 0)) em = e; }
  server.setEmail(em);
  g = await openGame(server);
  await playPractice(g, 'hold');
  await g.click(/^On to Year 6/);
  await g.click(/^Begin Quarter 1/);
  ok(!!g.doc.querySelector('.lr-modal-backdrop .lr-rumor'), 'a Q1 rumor pops up (' + em + ')');
  g = await openGame(server);                          // reload mid-quarter
  ok(!!g.doc.querySelector('.lr-modal-backdrop .lr-rumor'), 'after a reload the unanswered rumor is still waiting');
  await g.click(/^Thrilled$/);
  const flaky = { failNext: ['advance'] };
  g.w.eval('void 0');
  const before = g.G().phase;
  // simulate a dropped connection on the next Advance
  g = await openGame(server, flaky);
  await g.click(/^Thrilled$/);
  g.btn(/^Advance to Q2/).click(); await g.settle(20);
  ok(g.G().phase === before && /Nothing was lost/.test(g.doc.body.textContent) && !g.doc.querySelector('.lr-modal-backdrop .lr-rumor'), 'dropped connection: stays in Q1, says nothing was lost, rumor stays answered');
  await g.click(/^Advance to Q2/);
  ok(g.G().phase === 'q1' && g.G().rumorMoods[Object.keys(g.G().rumorMoods)[0]] === 'Thrilled', 'the retry goes through and keeps the feeling picked');
  ok(g.errors.length === 0, 'no page errors');

  // ── 10. teacher can skip the practice round ──────────────────────────────
  console.log('\n[10] teacher skip');
  server.setEmail(C.TEACHERS[0]);
  C.resetMe();
  g = await openGame(server, {});
  await g.settle(10);
  const prev = g.btn(/Preview as student/); if (prev) { prev.click(); await g.settle(); }
  await g.click(/^Skip practice/);
  ok(/You're ready/.test(text(g)) || /Start of Year 6/.test(text(g)), 'Skip practice jumps to the end of the practice round');

  server.setEmail(C.TEACHERS[0]); C.resetMe();
  g = await openGame(server); await g.settle(30);
  const mrow = Array.from(g.doc.querySelectorAll('.lr-dash tr')).find(tr => tr.textContent.includes(em));
  ok(mrow && /Year 6/.test(mrow.textContent), 'dashboard: a student mid-game shows their game year (Year 6)');

  // ── 11. wait screen, row cache, mismatched server files ─────────────────
  console.log('\n[11] wait screen and server checks');
  server.setEmail('waiter@excelcenteraz.org');
  g = await openGame(server);
  await playPractice(g, 'hold');
  await g.click(/^On to Year 6/);
  g.btn(/^Begin Quarter 1/).click();
  const busyNow = g.doc.getElementById('lr-busy');
  ok(busyNow && busyNow.className === 'on' && /Opening Quarter 1/.test(busyNow.textContent) && g.doc.body.classList.contains('lr-busy-on'),
     'pressing an Advance button shows the wait screen right away ("Opening Quarter 1…")');
  await g.settle(20);
  ok(g.doc.getElementById('lr-busy').className === '' && /Quarter 1/.test(text(g)), 'the wait screen goes away when the server answers');
  ok(server.cache['row|waiter@excelcenteraz.org'] > 1, 'the server remembers the student\'s row (no rescan per click)');
  // the teacher sorts the sheet mid-year: the year-end save must still land in the right row
  const srows = server.sheets.Saves.rows, hdr = srows.shift(); srows.reverse(); srows.unshift(hdr);
  const otherBefore = JSON.stringify(srows.find(r => r[0] === 'v3.student@excelcenteraz.org'));
  for (let q = 0; q < 4; q++) { while (g.doc.querySelector('.lr-modal-backdrop .lr-rumor')) await g.click(/^Anxious$/); await g.click(/^(Advance to Q|Close out the year)/); }
  await g.click(/^Calm$/); await type(g, '.lr-reflect-box', 'Year six was calm and I kept my paycheck going in.'); await g.click(/^On to Year 7/);
  ok(g.G().year === 1 && srows.find(r => r[0] === 'waiter@excelcenteraz.org')[2] === 1 &&
     JSON.stringify(srows.find(r => r[0] === 'v3.student@excelcenteraz.org')) === otherBefore, 'after the sheet is re-sorted, the year-end save still lands in the right row');
  // mismatched server files: the game says so instead of half-working
  const realPF = C.publicForecast_;
  C.publicForecast_ = undefined;
  g = await openGame(server);
  ok(/server files don't match/.test(text(g)) && /Code\.gs/.test(text(g)) && !g.doc.querySelector('.lr-instr'), 'Market.gs from another version: a teacher message, no half-working game');
  C.publicForecast_ = realPF;
  const realBoot = C.bootPayload_;
  C.bootPayload_ = function () { const b = realBoot.apply(null, arguments); delete b.api; return b; };
  g = await openGame(server);
  ok(/server files don't match/.test(text(g)), 'Code.gs from an older version (no version number): the same teacher message');
  C.bootPayload_ = realBoot;

  // ── 12. hot copy: the sheet is written once a year, on Save, and survives a lost cache ──
  console.log('\n[12] fast saves (cache) and durable saves (sheet)');
  server.setEmail('hot@excelcenteraz.org');
  g = await openGame(server);
  await playPractice(g, 'hold');
  await g.click(/^On to Year 6/);
  const sheetRow = () => server.sheets.Saves.rows.find(r => r[0] === 'hot@excelcenteraz.org');
  const before6 = JSON.stringify(sheetRow());
  await g.click(/^Begin Quarter 1/);
  for (let q = 0; q < 3; q++) { while (g.doc.querySelector('.lr-modal-backdrop .lr-rumor')) await g.click(/^Anxious$/); await g.click(/^Advance to Q/); }
  ok(g.G().phase === 'q3' && JSON.stringify(sheetRow()) === before6, 'four quarter clicks: the sheet was not touched (cache only)');
  // 💾 Save mid-quarter, after a trade
  while (g.doc.querySelector('.lr-modal-backdrop .lr-rumor')) await g.click(/^Anxious$/);
  const idxBuy = cardBtn(g, 'Index 5', /^\+\$100$/); idxBuy.click(); await g.settle(3);
  const hysAfterBuy = g.G().hys;
  g.doc.querySelector('.lr-chip').click();
  ok(g.doc.getElementById('lr-busy').className === 'on' && /Saving/.test(g.doc.getElementById('lr-busy').textContent), 'Save shows the wait screen ("Saving…")');
  await g.settle(20);
  ok(sheetRow()[3] === 'q3' && Math.abs(JSON.parse(sheetRow()[5]).hys - hysAfterBuy) < 0.01 && /Saved/.test(g.doc.querySelector('.lr-chip').textContent), 'Save writes the sheet now, trades included');
  // the cache loses everything (or 6 hours pass): reload resumes from the saved point
  for (const k in server.cache) delete server.cache[k];
  g = await openGame(server);
  ok(g.G().phase === 'q3' && Math.abs(g.G().hys - hysAfterBuy) < 0.01 && g.errors.length === 0, 'cache lost: reload resumes at the saved quarter, with the trade');
  // close out the year: the sheet is written at the year end
  while (g.doc.querySelector('.lr-modal-backdrop .lr-rumor')) await g.click(/^Anxious$/);
  await g.click(/^Close out the year/);
  await g.click(/^Calm$/); await type(g, '.lr-reflect-box', 'I saved in the middle of the year and nothing was lost.'); await g.click(/^On to Year 7/);
  ok(sheetRow()[2] === 1 && sheetRow()[3] === 'choose', 'the end of the year writes the sheet (Year 7, start of year)');
  // cache lost mid-year with no Save: the game falls back to the last year end, no errors
  await g.click(/^Begin Quarter 1/);
  while (g.doc.querySelector('.lr-modal-backdrop .lr-rumor')) await g.click(/^Anxious$/);
  await g.click(/^Advance to Q2/);
  for (const k in server.cache) delete server.cache[k];
  while (g.doc.querySelector('.lr-modal-backdrop .lr-rumor')) await g.click(/^Anxious$/);
  await g.click(/^Advance to Q3/);
  ok(g.G().year === 1 && g.G().phase === 'choose' && /Start of Year 7/.test(text(g)) && g.errors.length === 0, 'cache lost mid-year: back to the start of Year 7 (the last year end), no errors');
  await g.click(/^Begin Quarter 1/);
  ok(g.G().phase === 'q0', '...and play continues');
  // the dashboard shows where students are right now, from the cache
  server.setEmail(C.TEACHERS[0]);
  let tg = await openGame(server); await tg.settle(30);
  const hrow = Array.from(tg.doc.querySelectorAll('.lr-dash tr')).find(tr => tr.textContent.includes('hot@excelcenteraz.org'));
  ok(hrow && /Year 7/.test(hrow.textContent) && /q0/.test(hrow.textContent), 'dashboard shows live progress (Year 7, q0) though the sheet says start of year');
  // a teacher reset clears the cached game too
  ok(C.resetStudent('hot@excelcenteraz.org').ok, 'teacher resets the student');
  server.setEmail('hot@excelcenteraz.org');
  g = await openGame(server, { seedStorage: {} });
  ok(g.G().year === 0 && g.G().phase === 'choose' && !g.G().tutorialDone, 'after a reset the student starts over (the cached game is gone too)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
