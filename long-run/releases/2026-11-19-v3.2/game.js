/* The Long Run — Game.html  (client engine, quarterly model)
 *
 * Server (Code.gs) owns WHERE you are and hands one reveal at a time; it never
 * leaks a future quarter. This file owns the PORTFOLIO + screens. The whole money
 * model is the one proven in verify_engine.js (19/19).
 *
 * Per year: choose (year-open) -> q0..q3 (deploy) -> verify (year-end) -> next.
 * Every year runs all four quarters (we always send 'TRADE' at choose, which the
 * server routes to q0). $1,000 post-tax lands EACH quarter into HYS. You deploy to
 * HYS / FUND / INDEX / individual stocks, sell anytime. Taxes settle once a year.
 *
 * v3 (Nov 2026): 25 game years = practice 1-5 (scripted, in this file, portfolio carries
 * over) + the live market 6-25 (server years 0-19). Start-of-year news
 * forecasts, mid-year rumors with a required mood check, year-end news-vs-reality and
 * rumor results, a printable summary report.
 *
 * SOURCE OF TRUTH: this file in sensei-nikku/stock-sim (long-run/<channel>/game.js),
 * loaded by the Apps Script Index.html shell. Nov 2026 changes: practice round
 * (before Year 1), typed reflections, header/net-worth agreement, hindsight
 * measured from last year's close, sub-friendly wording.
 */

// ─── small engine helpers ────────────────────────────────────────────────────
function divCut(t, yr) {
  var b = yr - QUIET_YEARS;
  if (b === 6) return t === 'TBK' ? 0.50 : 0.75;
  if (b === 7 || b === 8) return t === 'TBK' ? 0.40 : 0.70;
  return 1.0;
}
function divPerShare(t, yr) {                   // $/share for ONE quarter
  if (!DIV_BASE[t]) return 0;
  return DIV_BASE[t] * Math.pow(1 + DIV_GROWTH, yr - 1) * divCut(t, yr);
}
function weightedReturn(prev, cur) {            // FUND quarterly-rebalanced return
  var r = 0; for (var t in FUND_WEIGHTS) r += FUND_WEIGHTS[t] * (cur[t] / prev[t]); return r;
}
function round2(x) { return Math.round(x * 100) / 100; }
function money(x) { return '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }

// ─── State ────────────────────────────────────────────────────────────────────
var G = null;
function emptyLots() { var o = {}; INSTRUMENTS.forEach(function (k) { o[k] = []; }); return o; }
function freshState() {
  return {
    year: 0, phase: 'choose', choice: '', unlockedThrough: 0, done: false,
    hys: 0, lots: emptyLots(), lossCarry: 0,
    fundNav: 100, fundNavPrev: 100, fundQ: [], prevPrices: Object.assign({}, STARTING_PRICES),
    yr: { interest: 0, divs: 0, realShort: 0, realLong: 0 },
    lastCreditedQ: -1,
    saverHys: 0, dcaUnits: 0, dcaDivCash: 0,
    valueHistory: [], saverHistory: [], dcaHistory: [],
    hist: { MED: [], TBK: [], NVT: [], PPK: [], SHP: [], FUND: [], INDEX: [] },
    tape: { MED: [], TBK: [], NVT: [], PPK: [], SHP: [], FUND: [], INDEX: [] },
    emotions: [], reflected: [], reflections: [],
    tutorialDone: false, tutorial: null, practice: null, startStake: 0, tp: null,
    rumorSeen: {}, rumorMoods: {},
    ver: 3,
    reveal: null, isTeacher: false, preview: false, showReport: false
  };
}
function serialize() {
  var skip = { reveal: 1, isTeacher: 1, preview: 1, showReport: 1 };
  var keep = {}; for (var k in G) { if (!skip[k]) keep[k] = G[k]; }
  return JSON.stringify(keep);
}
function sharesHeld(s, inst) { var n = 0; (s.lots[inst] || []).forEach(function (l) { n += l.sh; }); return n; }

// ─── Pure money math (mirrors verify_engine.js) ───────────────────────────────
function priceOf(s, inst, prices, idx) {
  if (inst === 'INDEX') return idx;
  if (inst === 'FUND') return s.fundNav;
  return prices[inst];
}
function valueOf(s, prices, idx) {
  var v = s.hys;
  TICKERS.forEach(function (t) { v += sharesHeld(s, t) * (prices ? prices[t] : STARTING_PRICES[t]); });
  v += sharesHeld(s, 'FUND') * s.fundNav;
  v += sharesHeld(s, 'INDEX') * (idx == null ? 100 : idx);
  return v;
}
function creditQuarter(s, yearNum, prices) {
  s.hys += PAYCHECK_Q;
  DIV_PAYERS.forEach(function (t) {
    var d = sharesHeld(s, t) * divPerShare(t, yearNum);
    if (d) { s.hys += d; s.yr.divs += d; }
  });
  var basketQDiv = 0; DIV_PAYERS.forEach(function (t) { basketQDiv += BASKET_SHARES[t] * divPerShare(t, yearNum); });
  var idxDiv = sharesHeld(s, 'INDEX') * (basketQDiv / INDEX_DIVISOR);
  if (idxDiv) { s.hys += idxDiv; s.yr.divs += idxDiv; }
  s.fundNavPrev = s.fundNav;
  s.fundNav *= weightedReturn(s.prevPrices, prices);
  if (!s.fundQ || s.fundQ.length >= 4) s.fundQ = [];
  s.fundQ.push(round2(s.fundNav));
  s.prevPrices = Object.assign({}, prices);
}
function buy(s, inst, amount, prices, idx, yearNum) {
  if (amount > s.hys) amount = s.hys;
  if (amount <= 0) return;
  var px = priceOf(s, inst, prices, idx);
  if (px <= 0) return;
  s.lots[inst].push({ sh: amount / px, px: px, yr: yearNum });
  s.hys -= amount;
}
function sell(s, inst, shToSell, prices, idx, yearNum) {
  var px = priceOf(s, inst, prices, idx), remaining = shToSell;
  while (remaining > 1e-9 && s.lots[inst].length) {
    var lot = s.lots[inst][0], take = Math.min(lot.sh, remaining);
    var gain = (px - lot.px) * take;
    if (lot.yr === yearNum) s.yr.realShort += gain; else s.yr.realLong += gain;
    s.hys += take * px; lot.sh -= take; remaining -= take;
    if (lot.sh <= 1e-9) s.lots[inst].shift();
  }
}
// Pure: the annual tax bill, no mutation.
function computeBill(s) {
  var interestTax = s.yr.interest * TAX_ORDINARY;
  var dividendTax = s.yr.divs * TAX_PREF;
  var sg = Math.max(0, s.yr.realShort), sl = Math.max(0, -s.yr.realShort);
  var lg = Math.max(0, s.yr.realLong),  ll = Math.max(0, -s.yr.realLong);
  var pool = sl + ll + s.lossCarry;
  var uS = Math.min(sg, pool), taxableShort = sg - uS; pool -= uS;
  var uL = Math.min(lg, pool), taxableLong  = lg - uL; pool -= uL;
  var capTax = taxableShort * TAX_ORDINARY + taxableLong * TAX_PREF;
  return {
    interestTax: round2(interestTax), dividendTax: round2(dividendTax), capTax: round2(capTax),
    total: round2(interestTax + dividendTax + capTax), carryForward: round2(pool),
    taxableShort: round2(taxableShort), taxableLong: round2(taxableLong)
  };
}
// Apply year-end once (on commit): tax, advance benchmarks, record history, reset.
function applyYearEnd(s, yReveal, yearNum) {
  var bill = computeBill(s);
  s.hys -= bill.total; s.lossCarry = bill.carryForward;

  // benchmarks
  var yrInt = 0, fed = FED_RATES[yearNum - 1] / 100 / 4;
  for (var q = 0; q < 4; q++) { s.saverHys += PAYCHECK_Q; var i = s.saverHys * fed; s.saverHys += i; yrInt += i; }
  s.saverHys -= yrInt * TAX_ORDINARY;
  var basketQDiv = 0; DIV_PAYERS.forEach(function (t) { basketQDiv += BASKET_SHARES[t] * divPerShare(t, yearNum); });
  for (var q2 = 0; q2 < 4; q2++) {
    s.dcaUnits += PAYCHECK_Q / yReveal.index[q2];
    s.dcaDivCash += s.dcaUnits * (basketQDiv / INDEX_DIVISOR) * (1 - TAX_PREF);
  }

  var q4p = {}; TICKERS.forEach(function (t) { q4p[t] = yReveal.prices[t][3]; });
  var endValue = valueOf(s, q4p, yReveal.index[3]);
  s.valueHistory.push(round2(endValue));
  s.saverHistory.push(round2(s.saverHys));
  s.dcaHistory.push(round2(s.dcaUnits * yReveal.index[3] + s.dcaDivCash));
  TICKERS.forEach(function (t) { s.hist[t].push(round2(q4p[t])); });   // year-close record (for change anchors)
  s.hist.INDEX.push(round2(yReveal.index[3]));
  s.hist.FUND.push(round2(s.fundNav));
  // quarterly all-time tape: 4 points/yr, uniform granularity so the line never collapses
  if (!s.tape) s.tape = { MED: [], TBK: [], NVT: [], PPK: [], SHP: [], FUND: [], INDEX: [] };
  TICKERS.forEach(function (t) { yReveal.prices[t].forEach(function (v) { s.tape[t].push(round2(v)); }); });
  yReveal.index.forEach(function (v) { s.tape.INDEX.push(round2(v)); });
  (s.fundQ || []).forEach(function (v) { s.tape.FUND.push(round2(v)); });
  s.yr = { interest: 0, divs: 0, realShort: 0, realLong: 0 };
  return bill;
}

// ─── Boot / restore ───────────────────────────────────────────────────────────
function applyBoot(boot) {
  G = freshState();
  if (boot && boot.state) { try { Object.assign(G, JSON.parse(boot.state)); } catch (e) {} }
  G.rumorSeen = G.rumorSeen || {}; G.rumorMoods = G.rumorMoods || {};
  if (boot) {
    G.year = boot.year; G.phase = boot.phase; G.choice = boot.choice || G.choice;
    G.unlockedThrough = boot.unlockedThrough; G.reveal = boot.reveal || null;
    G.isTeacher = !!boot.isTeacher;
  }
  G.preview = false;
}

// ─── Server loop ───────────────────────────────────────────────────────────────
var LAST_ERR = '';
function retryNotice() { showError('Couldn\'t reach the game server (' + LAST_ERR + '). Nothing was lost \u2014 press the button again.'); }
async function step(choice) {
  var res;
  try { res = await Server.advance(G.year, G.phase, serialize(), choice); }
  catch (e) { LAST_ERR = String((e && e.message) || e); showError(LAST_ERR); return 'error'; }
  if (res && res.ok === false) {
    if (res.stale) { applyBoot(res.boot); render(); return 'stale'; }
    LAST_ERR = res.error || 'Something went wrong.'; showError(LAST_ERR); return 'error';
  }
  G.year = res.year; G.phase = res.phase; G.choice = res.choice;
  G.unlockedThrough = res.unlockedThrough; G.done = res.done; G.reveal = res.reveal;
  render();
  return 'ok';
}

// ─── Quarter entry: paycheck + interest + dividends, once per quarter ─────────
function qIndex() { return { q0: 0, q1: 1, q2: 2, q3: 3 }[G.phase]; }
function curPrices() { var r = G.reveal, o = {}; TICKERS.forEach(function (t) { var a = r.prices[t]; o[t] = a[a.length - 1]; }); return o; }
function curIndex() { var a = G.reveal.index; return a[a.length - 1]; }
function enterQuarterIfNeeded() {
  var gq = G.year * 4 + qIndex();
  if (G.lastCreditedQ < gq) { creditQuarter(G, G.year + 1, curPrices()); G.lastCreditedQ = gq; }
}
// Advance a quarter. Interest accrues HERE, at quarter-end, on whatever you LEFT
// in HYS — money you deployed this quarter earns no savings interest (the cost of
// waiting in cash is real). Guarded against double-clicks.
var advancing = false;
async function commitQuarter() {
  if (advancing || pendingRumor()) return;      // a new rumor must be answered first
  advancing = true;
  var snap = serialize();
  var i = G.hys * (FED_RATES[G.year] / 100 / 4);
  G.hys += i; G.yr.interest += i;
  try {
    var r = await step();
    if (r === 'error') { Object.assign(G, JSON.parse(snap)); render(); retryNotice(); }  // undo so a retry doesn't double-credit (stale already replaced G)
  } finally { advancing = false; }
}

// ─── Render router ─────────────────────────────────────────────────────────────
// ─── Persistent top chrome: header bar + 15-year progress + phase label ────────
function headerValue() {
  if (G.phase === 'done') return G.valueHistory.length ? G.valueHistory[G.valueHistory.length - 1] : 0;
  if (G.phase === 'verify' && G.reveal && G.reveal.prices) {   // match "Ended with" (after the tax bill)
    try { return valueOf(G, curPrices(), curIndex()) - computeBill(G).total; } catch (e) {}
  }
  if (G.phase !== 'choose' && G.reveal && G.reveal.prices) {
    try { return valueOf(G, curPrices(), curIndex()); } catch (e) {}
  }
  if (G.phase === 'choose' && G.year > 0) {
    try { return valueOf(G, soyPrices(), soyIndex()); } catch (e) {}
  }
  return valueOf(G, null, 100);
}
function gameYear() { return G.phase === 'done' ? TOTAL_YEARS : G.year + 1 + PRACTICE_YEARS; }
function chromeTop() {
  var y = gameYear();
  var done = PRACTICE_YEARS + (G.phase === 'done' ? SERVER_YEARS : (G.year || 0));   // practice always counts as done
  var nowSeg = (G.phase === 'done') ? 0 : done + 1;
  var segs = '';
  for (var i = 1; i <= TOTAL_YEARS; i++) {
    var cls = i <= done ? 'done' : (i === nowSeg ? 'now' : 'future');
    var gap = (i === PRACTICE_YEARS + 1) ? ' lr-seg-break' : '';          // practice | live market, nothing else
    segs += '<span class="lr-seg lr-seg-' + cls + gap + '"></span>';
  }
  var label = { choose: 'Start of Year', q0: 'Quarters', q1: 'Quarters', q2: 'Quarters',
                q3: 'Quarters', verify: 'Year in Review', done: 'Final Results' }[G.phase] || '';
  if (G.phase !== 'done' && label) label = 'Live market \u00B7 ' + label;
  var name = G.playerName ? '<span class="lr-name">' + esc(G.playerName) + '</span>' : '';
  return '<div class="lr-chrome">' +
    '<div class="lr-topbar">' +
      '<div class="lr-actions">' + name +
        '<button class="lr-chip" onclick="headerSave(this)">\uD83D\uDCBE Save</button>' +
        '<button class="lr-chip" onclick="openReport()">\uD83D\uDDA8 Report</button>' +
      '</div>' +
      '<div class="lr-yearpill">Year ' + y + '</div>' +
      '<div class="lr-port"><span class="lr-port-label">Portfolio</span>' +
        '<span class="lr-port-val">' + money(headerValue()) + '</span></div>' +
    '</div>' +
    '<div class="lr-rule"></div>' +
    '<div class="lr-progress">' + segs + '</div>' +
    (label ? '<div class="lr-phaselabel">' + label + '</div>' : '') +
  '</div>';
}
function headerSave(btn) {              // progress auto-commits each step; this just reassures the student
  var t = btn.innerHTML; btn.innerHTML = '\u2713 Saves each time you Advance'; btn.disabled = true;
  setTimeout(function () { btn.innerHTML = t; btn.disabled = false; }, 2500);
}
function headerReset() {
  // Student-side reset removed: students can no longer reset their own game.
  // Resets are teacher-only via the dashboard (resetStudent / resetMyGame).
}

// ─── Render router ─────────────────────────────────────────────────────────────
function render() {
  var app = document.getElementById('app');
  if (!G) { app.innerHTML = signInNotice(); return; }
  if (G.showReport) { app.innerHTML = renderReportView(); return; }
  if (G.isTeacher && !G.preview) { app.innerHTML = renderTeacherPanel(); loadDashboard(); return; }
  if (tutorialPending()) {
    var th = tutRender();
    if (G.isTeacher && G.preview) th = '<div class="lr-previewbar">Previewing as a student<button onclick="exitPreview()">\u2190 Teacher panel</button></div>' + th;
    app.innerHTML = th; return;
  }
  if (/^q[0-3]$/.test(G.phase)) enterQuarterIfNeeded();   // header must include this quarter's paycheck
  var KNOWN = { choose: 1, q0: 1, q1: 1, q2: 1, q3: 1, verify: 1, done: 1 };
  var html = (KNOWN[G.phase] ? chromeTop() : '') + phaseHtml();
  var pr = pendingRumor();
  if (pr) html += rumorModal(pr);                           // a new rumor: must answer how it feels first
  else if (KNOWN[G.phase]) { html += newsFab() + newsModal(); }
  if (G.isTeacher && G.preview) {
    html = '<div class="lr-previewbar">Previewing as a student<button onclick="exitPreview()">← Teacher panel</button></div>' + html;
  }
  app.innerHTML = html;
}
function phaseHtml() {
  switch (G.phase) {
    case 'choose': return renderYearOpen();
    case 'q0': case 'q1': case 'q2': case 'q3': enterQuarterIfNeeded(); return renderQuarter();
    case 'verify': return renderVerify();
    case 'done': return renderDone();
    default: return signInNotice();
  }
}
function signInNotice() {
  return '<div class="lr-card"><h2>The Long Run</h2><p>Open this with your Excel Center account to start. ' +
    (Server.available ? 'You appear to be signed out.' : 'This needs to run from the deployed web-app link.') + '</p></div>';
}

// ─── Year-open ─────────────────────────────────────────────────────────────────
function renderYearOpen() {
  var y = gameYear(), fed = FED_RATES[G.year];
  var fedNote = fed <= 1 ? ' — cash earns almost nothing.' : fed >= 4 ? ' — savers are being paid well.' : '.';
  var first = (G.year === 0);
  var intro = first
    ? 'Your practice portfolio came with you: the shares and savings below are yours. From here the market is live, and your paycheck is <strong>' + money(PAYCHECK_Q) + '</strong> a quarter. Read this year\'s forecasts, then get your bearings.'
    : 'These are <strong>last year\'s closing prices</strong>. Sell holdings or put savings to work now, before this year\'s first quarter — or just move on and decide quarter by quarter.';
  var p = soyPrices(), idx = soyIndex();
  var rows = INSTRUMENTS.map(function (inst) { return soyRow(inst, p, idx); }).join('');
  return '<div class="lr-card">' +
    '<div class="lr-year">Start of Year ' + y + '</div>' +
    '<h2>' + (first ? 'Welcome to the live market' : 'Before the market opens') + '</h2>' +
    '<p class="lr-muted">' + intro + '</p>' +
    (first ? realGameGuide() : '') +
    forecastBlock(G.reveal.news, true) +
    '<div class="lr-fed">High-yield savings pays <strong>' + fed.toFixed(2) + '%</strong> this year' + fedNote + '</div>' +
    '<div class="lr-standing">' +
      '<div><span class="lr-dim">Savings (HYS)</span><strong>' + money(G.hys) + '</strong></div>' +
      '<div><span class="lr-dim">Net worth</span><strong>' + money(valueOf(G, p, idx)) + '</strong></div>' +
    '</div>' +
    '<div class="lr-soywrap"><table class="lr-trade lr-soy">' +
      '<thead><tr><th>Instrument</th><th>' + (first ? 'Starting price' : 'Last close') + '</th><th>Buy from savings</th><th>Holding</th><th>Sell</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table></div>' +
    '<button class="lr-advance" onclick="step(\'TRADE\')">Begin Quarter 1 →</button>' +
    '</div>';
}
function soyPrices() { var o = {}; TICKERS.forEach(function (t) { var a = G.hist[t]; o[t] = (a && a.length) ? a[a.length - 1] : STARTING_PRICES[t]; }); return o; }
function soyIndex() { var a = G.hist.INDEX; return (a && a.length) ? a[a.length - 1] : 100; }
function soyPriceOf(inst, p, idx) { return inst === 'INDEX' ? idx : inst === 'FUND' ? G.fundNav : p[inst]; }
function soyRow(inst, p, idx) {
  var isStock = inst !== 'FUND' && inst !== 'INDEX';
  var meta = isStock ? STOCKS[inst] : FUNDS[inst];
  var px = soyPriceOf(inst, p, idx), sh = sharesHeld(G, inst);
  var pays = (inst === 'INDEX' || inst === 'TBK' || inst === 'SHP');
  var nameCell = '<b style="color:' + meta.color + '">' + (isStock ? inst : meta.name) + '</b>' +
    (isStock ? ' <span class="lr-dim">' + esc(meta.name) + '</span>' : '') +
    (pays ? ' <span class="lr-divtag">DIV</span>' : '');
  var buys = BUY_AMOUNTS.map(function (amt) {
    return '<button' + (G.hys < amt ? ' disabled' : '') + ' onclick="soyBuy(\'' + inst + '\',' + amt + ')">+$' + amt + '</button>';
  }).join('');
  var hold = sh > 0 ? '<span class="lr-hold">' + sh.toFixed(2) + ' sh</span>' : '<span class="lr-dim">—</span>';
  var sells = sh > 0
    ? '<button onclick="soySell(\'' + inst + '\',0.3333)">\u2153</button>' +
      '<button onclick="soySell(\'' + inst + '\',0.6667)">\u2154</button>' +
      '<button class="lr-sell" onclick="soySell(\'' + inst + '\',1)">All</button>'
    : '<span class="lr-dim">—</span>';
  return '<tr><td>' + nameCell + '</td><td class="lr-price">' + money(px) + '</td>' +
    '<td>' + buys + '</td><td>' + hold + '</td><td>' + sells + '</td></tr>';
}
function soyBuy(inst, amt) { buy(G, inst, amt, soyPrices(), soyIndex(), G.year + 1); render(); }
function soySell(inst, frac) { sell(G, inst, sharesHeld(G, inst) * frac, soyPrices(), soyIndex(), G.year + 1); render(); }

// ─── Quarter (the four-deploy screen) ─────────────────────────────────────────
var newsOpen = false;
function toggleNews() { newsOpen = !newsOpen; render(); }
function newsAvailable() {
  var r = G.reveal; if (!r || !r.news) return 0;
  return (r.news.length || 0) + ((r.rumors || []).length);
}
function newsFab() {
  var total = newsAvailable(); if (!total) return '';
  return '<button class="lr-newsfab" onclick="toggleNews()">\uD83D\uDCF0 News &amp; Rumors <span class="lr-newsbadge">' + total + '</span></button>';
}
function newsModal() {
  if (!newsOpen || !newsAvailable()) return '';
  var r = G.reveal;
  return '<div class="lr-modal-backdrop" onclick="if(event.target===this)toggleNews()">' +
    '<div class="lr-modal lr-modal-news">' +
      '<button class="lr-modal-x" onclick="toggleNews()">\u00D7</button>' +
      '<div class="lr-modal-tag" style="color:var(--blue)">Year ' + gameYear() + ' \u00B7 the news</div>' +
      '<h3>What\'s moving the market</h3>' +
      forecastBlock(r.news, false) + rumorBlock(r.rumors) +
    '</div></div>';
}
function renderQuarter() {
  var r = G.reveal, q = qIndex(), p = curPrices(), idx = curIndex(), y = gameYear(), fed = FED_RATES[G.year];
  var cards = INSTRUMENTS.map(function (inst) { return instrumentCard(inst, p, idx, y); }).join('');
  return '<div class="lr-card">' +
    '<div class="lr-year">Year ' + y + ' · Quarter ' + (q + 1) + '</div>' +
    rumorUpdates(r, q) +
    '<div class="lr-standing">' +
      '<div><span class="lr-dim">Savings (HYS)</span><strong>' + money(G.hys) + '</strong></div>' +
      '<div><span class="lr-dim">HYS rate</span><strong>' + fed.toFixed(2) + '%</strong></div>' +
      '<div><span class="lr-dim">Net worth</span><strong>' + money(valueOf(G, p, idx)) + '</strong></div>' +
    '</div>' +
    '<div class="lr-instr-grid">' + cards + '</div>' +
    '<p class="lr-muted">Money left in HYS earns ' + (fed / 4).toFixed(2) + '% at quarter-end. Money you deploy doesn\'t.</p>' +
    '<button class="lr-advance" onclick="commitQuarter()">' + (q < 3 ? 'Advance to Q' + (q + 2) + ' →' : 'Close out the year →') + '</button>' +
    '</div>';
}
function instrumentCard(inst, p, idx, y) {
  var isFund = (inst === 'FUND'), isIndex = (inst === 'INDEX'), isStock = !isFund && !isIndex;
  var meta = isStock ? STOCKS[inst] : FUNDS[inst];
  var price = priceOf(G, inst, p, idx), sh = sharesHeld(G, inst), val = sh * price;
  var ty = thisYearSeries(inst);
  var yrSpark = priceSpark(ty, netColor(ty));
  var prev = prevPriceOf(inst), diff = (prev == null) ? null : price - prev;
  var pays = (isIndex || inst === 'TBK' || inst === 'SHP');
  var primary = isStock ? inst : meta.name, secondary = isStock ? meta.name : meta.note;
  return '<div class="lr-instr">' +
    '<div class="lr-instr-head"><span class="lr-instr-name"><b style="color:' + meta.color + '">' + primary + '</b> <span class="lr-dim">' + esc(secondary) + '</span></span>' +
      (pays ? '<span class="lr-divtag">DIV</span>' : '') + '</div>' +
    '<div class="lr-instr-price"><span class="lr-price">' + money(price) + '</span>' +
      (diff == null ? '<span class="lr-chg lr-flat">·</span>' : chgTag(diff, true)) + '</div>' +
    '<div class="lr-instr-sparks">' +
      '<div class="lr-sparkcell"><span class="lr-sparklabel">This yr</span>' + yrSpark + '</div>' +
      '<div class="lr-sparkcell"><span class="lr-sparklabel">All-time</span>' + priceSpark(allTimeSeries(inst), allTimeColor(inst)) + '</div>' +
    '</div>' +
    '<div class="lr-instr-hold">' + (sh > 0 ? 'You hold ' + sh.toFixed(2) + ' sh · ' + money(val) : '<span class="lr-dim">Not held</span>') + '</div>' +
    '<div class="lr-instr-actions">' +
      BUY_AMOUNTS.map(function (amt) { return '<button' + (G.hys < amt ? ' disabled' : '') + ' onclick="doBuy(\'' + inst + '\',' + amt + ')">+$' + amt + '</button>'; }).join('') +
      '<button class="lr-sell"' + (sh > 0 ? '' : ' disabled') + ' onclick="doSell(\'' + inst + '\',0.5)">Sell ½</button>' +
      '<button class="lr-sell"' + (sh > 0 ? '' : ' disabled') + ' onclick="doSell(\'' + inst + '\',1)">Sell all</button>' +
    '</div></div>';
}
function sparkColor(a) { return a.length < 2 ? 'var(--muted)' : a[a.length - 1] >= a[a.length - 2] ? 'var(--pos)' : 'var(--neg)'; }
function netColor(a) { return a.length < 2 ? 'var(--muted)' : a[a.length - 1] >= a[0] ? 'var(--pos)' : 'var(--neg)'; }
// Prior reference price for the quarter-over-quarter change: last quarter this year,
// else last year's close (from hist), else the starting price.
function prevPriceOf(inst) {
  if (inst === 'FUND') return G.fundNavPrev;
  if (inst === 'INDEX') { var b = G.reveal.index; return b.length > 1 ? b[b.length - 2] : (G.hist.INDEX.length ? G.hist.INDEX[G.hist.INDEX.length - 1] : 100); }
  var a = G.reveal.prices[inst];
  return a.length > 1 ? a[a.length - 2] : (G.hist[inst].length ? G.hist[inst][G.hist[inst].length - 1] : STARTING_PRICES[inst]);
}
// This year's path, anchored at last year's close so even Q1 draws a real segment.
function thisYearSeries(inst) {
  var anchor, cur;
  if (inst === 'FUND') { anchor = G.hist.FUND.length ? G.hist.FUND[G.hist.FUND.length - 1] : 100; cur = G.fundQ || []; }
  else if (inst === 'INDEX') { anchor = G.hist.INDEX.length ? G.hist.INDEX[G.hist.INDEX.length - 1] : 100; cur = G.reveal.index; }
  else { anchor = G.hist[inst].length ? G.hist[inst][G.hist[inst].length - 1] : STARTING_PRICES[inst]; cur = G.reveal.prices[inst]; }
  return [anchor].concat(cur);
}
// All-time tape: every quarter ever played (4/yr) + this year's revealed quarters.
function allTimeSeries(inst) {
  var past = (G.tape && G.tape[inst]) ? G.tape[inst].slice() : [];
  var cur = (inst === 'FUND') ? (G.fundQ || []) : (inst === 'INDEX') ? G.reveal.index : G.reveal.prices[inst];
  return past.concat(cur);
}
function allTimeColor(inst) { return netColor(allTimeSeries(inst)); }
function doBuy(inst, amount) { buy(G, inst, amount, curPrices(), curIndex(), G.year + 1); render(); }
function doSell(inst, frac) { sell(G, inst, sharesHeld(G, inst) * frac, curPrices(), curIndex(), G.year + 1); render(); }

// ─── Year-end (lean): money + tax bill + truths + hindsight + gated emotion ───
var EMOTIONS = ['Anxious', 'Confident', 'Regretful', 'Calm', 'Thrilled'];
function saverProjection(yearNum) {
  var s = G.saverHys, yrInt = 0, fed = FED_RATES[yearNum - 1] / 100 / 4;
  for (var q = 0; q < 4; q++) { s += PAYCHECK_Q; var ii = s * fed; s += ii; yrInt += ii; }
  s -= yrInt * TAX_ORDINARY;
  return round2(s);
}
function renderVerify() {
  var r = G.reveal, bill = computeBill(G);
  var q4p = {}; TICKERS.forEach(function (t) { q4p[t] = r.prices[t][3]; });
  var preTax = valueOf(G, q4p, r.index[3]);
  var startV = G.valueHistory.length ? G.valueHistory[G.valueHistory.length - 1] : (G.startStake || 0);
  var contrib = PAYCHECK_Q * 4, I = G.yr.interest, D = G.yr.divs;
  var market = preTax - startV - contrib - I - D;
  var endV = preTax - bill.total;
  var saved = saverProjection(G.year + 1), aheadBy = endV - saved;
  var cmp = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:11px 14px;margin:8px 0 2px;font-size:14px">' +
    '<span>If you had <strong>just saved</strong> every paycheck, you\'d have <strong>' + money(saved) + '</strong></span>' +
    (Math.round(aheadBy) === 0
      ? '<span class="lr-muted" style="font-family:var(--mono);font-weight:700">= same as just saving</span></div>'
      : '<span class="' + (aheadBy > 0 ? 'lr-true' : 'lr-false') + '" style="font-family:var(--mono);font-weight:700">' + (aheadBy > 0 ? '\u25B2 ahead by ' : '\u25BC behind by ') + money(Math.abs(aheadBy)) + '</span></div>');
  return '<div class="lr-card">' +
    '<div class="lr-year">Year ' + gameYear() + ' — ' + esc(r.title) + '</div>' +
    '<div class="lr-gl"><table>' +
      row('Started the year with', money(startV)) +
      row('Your paychecks added', '+' + money(contrib)) +
      row('Interest earned', '+' + money(I)) +
      row('Dividends collected', '+' + money(D)) +
      row('What your investments did', (market >= 0 ? '+' : '−') + money(Math.abs(market)), market >= 0 ? 'lr-true' : 'lr-false') +
      row('Taxes settled', '−' + money(bill.total), 'lr-false') +
      '<tr class="lr-gl-end"><td>Ended with</td><td>' + money(endV) + '</td></tr>' +
    '</table></div>' +
    cmp +
    eoyTickerTable(r) +
    eoyGallery(r) +
    taxBillBlock(bill) +
    forecastCheck(r) +
    rumorResults(r) +
    storiesBlock(r) +
    hindsightBlock(r) +
    emotionBlock() +
    reflectBlock(r) +
    advanceGate(r) +
    '</div>';
}
function advanceGate(r) {
  var hasE = !!G.emotions[G.year], hasR = !!G.reflected[G.year];
  if (hasE && hasR) return '<button id="lr-gate" class="lr-advance" onclick="commitVerify()">' + (G.year >= LAST_SERVER_YEAR ? 'See your final results →' : 'On to Year ' + (gameYear() + 1) + ' →') + '</button>';
  var msg = !hasE ? '↑ Tap how this year felt to continue' : '↑ Write a sentence or two above to continue';
  return '<button id="lr-gate" class="lr-advance" disabled style="opacity:.45;cursor:not-allowed;">' + msg + '</button>';
}
function row(label, val, cls) { return '<tr><td>' + label + '</td><td' + (cls ? ' class="' + cls + '"' : '') + '>' + val + '</td></tr>'; }
// EOY quarterly price grid (mirrors v3.5's record screen) — anchors the reflection.
function eoyTickerTable(r) {
  function cells(q, dp) { return q.map(function (v) { return '<td class="lr-mono">' + (dp ? v.toFixed(1) : money(v)) + '</td>'; }).join(''); }
  function held(sh) { return '<td class="lr-dim">' + (sh > 0 ? sh.toFixed(2) + ' sh' : '—') + '</td>'; }
  var stockRows = TICKERS.map(function (t) {
    return '<tr><td><b style="color:' + STOCKS[t].color + '">' + t + '</b> <span class="lr-dim">' + STOCKS[t].name + '</span></td>' +
      cells(r.prices[t], false) + held(sharesHeld(G, t)) + '</tr>';
  }).join('');
  var idxRow = '<tr class="lr-aggrow"><td><b style="color:' + FUNDS.INDEX.color + '">' + FUNDS.INDEX.name + '</b></td>' +
    cells(r.index, true) + held(sharesHeld(G, 'INDEX')) + '</tr>';
  var fq = (G.fundQ && G.fundQ.length === 4) ? G.fundQ : [G.fundNav, G.fundNav, G.fundNav, G.fundNav];
  var fundRow = '<tr><td><b style="color:' + FUNDS.FUND.color + '">' + FUNDS.FUND.name + '</b></td>' +
    cells(fq, true) + held(sharesHeld(G, 'FUND')) + '</tr>';
  return '<div class="lr-tickers"><h4>How each ticker moved this year</h4>' +
    '<div class="lr-tickwrap"><table class="lr-ticktbl">' +
    '<thead><tr><th>What</th><th>Q1</th><th>Q2</th><th>Q3</th><th>Q4</th><th>You held</th></tr></thead>' +
    '<tbody>' + stockRows + idxRow + fundRow + '</tbody></table></div></div>';
}
// Price-history gallery — the per-ticker charts from the old Reflect page.
function histSpark(arr, color) {
  var W = 150, H = 46, pad = 3;
  if (!arr || arr.length < 2) return '<svg class="lr-galspark" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '"></svg>';
  var max = Math.max.apply(null, arr), min = Math.min.apply(null, arr), n = arr.length, span = max - min || 1;
  function px(i) { return (pad + (i / (n - 1)) * (W - 2 * pad)).toFixed(1); }
  function py(v) { return ((H - pad) - ((v - min) / span) * (H - 2 * pad)).toFixed(1); }
  var line = arr.map(function (v, i) { return (i ? 'L' : 'M') + px(i) + ' ' + py(v); }).join(' ');
  var area = 'M' + px(0) + ' ' + (H - pad) + ' ' + arr.map(function (v, i) { return 'L' + px(i) + ' ' + py(v); }).join(' ') + ' L' + px(n - 1) + ' ' + (H - pad) + ' Z';
  return '<svg class="lr-galspark" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '" preserveAspectRatio="none">' +
    '<path d="' + area + '" fill="' + color + '" fill-opacity="0.12" stroke="none"/>' +
    '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + px(n - 1) + '" cy="' + py(arr[n - 1]) + '" r="2.3" fill="' + color + '"/></svg>';
}
function eoyGallery(r) {
  var cells = INSTRUMENTS.map(function (inst) {
    var meta = (inst === 'FUND' || inst === 'INDEX') ? FUNDS[inst] : STOCKS[inst];
    var label = (inst === 'FUND' || inst === 'INDEX') ? meta.name : inst;
    return '<div class="lr-galcell"><div class="lr-gallabel" style="color:' + meta.color + '">' + label + '</div>' +
      histSpark(allTimeSeries(inst), meta.color) + '</div>';
  }).join('');
  return '<div class="lr-gallery"><h4>Price history through Year ' + gameYear() + '</h4>' +
    '<div class="lr-galgrid">' + cells + '</div></div>';
}
function taxBillBlock(b) {
  if (b.total <= 0 && b.carryForward <= 0) return '<p class="lr-muted">No taxes this year — nothing your money earned was taxable.</p>';
  var parts = [];
  if (b.interestTax > 0) parts.push('interest ' + money(b.interestTax) + ' (22%)');
  if (b.dividendTax > 0) parts.push('dividends ' + money(b.dividendTax) + ' (15%)');
  if (b.capTax > 0) parts.push('capital gains ' + money(b.capTax));
  var s = '<div class="lr-taxbill"><h4>Tax bill, paid from HYS</h4><p>' +
    (parts.length ? parts.join(' · ') + ' · <strong>total ' + money(b.total) + '</strong>' : 'none this year') + '</p>';
  if (b.carryForward > 0) s += '<p class="lr-muted">You banked ' + money(b.carryForward) + ' in losses to offset future gains.</p>';
  return s + '</div>';
}
function hindsightBlock(r) {
  var obs = hindsight(r); if (!obs.length) return '';
  return '<div class="lr-journal"><h4>In hindsight</h4>' + obs.map(function (o) { return '<p>' + esc(o) + '</p>'; }).join('') + '</div>';
}
function hindsight(r) {
  var out = [], idxRet = r.index[3] / soyIndex() - 1;   // last year's close -> this Q4
  var q4p = {}; TICKERS.forEach(function (t) { q4p[t] = r.prices[t][3]; });
  var net = valueOf(G, q4p, r.index[3]), cashFrac = net > 0 ? G.hys / net : 1;
  if (cashFrac > 0.6 && idxRet > 0.03)
    out.push('You kept most of your money in savings while the market rose ' + Math.round(idxRet * 100) + '% this year. Safe — but that cash sat out the gain.');
  if (G.yr.realShort > 50)
    out.push('You locked in ' + money(G.yr.realShort) + ' of short-term gains, taxed at 22%. Holding past a year would have dropped that to 15%.');
  if (sharesHeld(G, 'FUND') > 0 && idxRet > 0) {
    var fundSh = sharesHeld(G, 'FUND') * G.fundNav;
    out.push('Your GrowthFund stake (' + money(fundSh) + ') earned no dividends this year — the same money in the Index would have paid you to hold it.');
  }
  if (G.yr.realShort < -50 || G.yr.realLong < -50)
    out.push('You sold at a loss this year. Sometimes that\'s discipline, sometimes it\'s panic — the banked loss does at least shelter a future gain from tax.');
  return out.slice(0, 2);
}
function emotionBlock() {
  var sel = G.emotions[G.year] || '';
  var btns = EMOTIONS.map(function (e) { return '<button class="lr-emotion' + (sel === e ? ' lr-emotion-on' : '') + '" onclick="tapEmotion(\'' + e + '\')">' + e + '</button>'; }).join('');
  return '<div class="lr-feel"><h4>How did this year feel?</h4><div class="lr-emotions">' + btns + '</div></div>';
}
function tapEmotion(e) { G.emotions[G.year] = e; render(); }
// A short, behavior-anchored prompt the student answers right here; it saves with the game
// (on the year-end Advance) and the teacher can read it from the dashboard.
var REFLECT_MIN = 8;   // words
function wordCount(s) { return String(s || '').trim().split(/\s+/).filter(Boolean).length; }
function reflectCount(txt) {
  var n = wordCount(txt);
  return n >= REFLECT_MIN ? '<span class="lr-true">\u2713 ' + n + ' words</span>'
                          : n + ' of ' + REFLECT_MIN + ' words';
}
function reflectBlock(r) {
  var txt = (G.reflections && G.reflections[G.year]) || '';
  return '<div class="lr-reflect"><h4>Reflect — write it here</h4>' +
    '<p class="lr-prompt">' + esc(journalPrompt(r)) + '</p>' +
    '<textarea class="lr-reflect-box" rows="3" maxlength="1000" placeholder="A sentence or two..." oninput="reflectInput(this)">' + esc(txt) + '</textarea>' +
    '<div class="lr-reflect-count" id="lr-reflect-count">' + reflectCount(txt) + '</div></div>';
}
function reflectInput(el) {                // no re-render while typing (it would drop the cursor)
  if (!G.reflections) G.reflections = [];
  G.reflections[G.year] = el.value;
  G.reflected[G.year] = wordCount(el.value) >= REFLECT_MIN;
  var c = document.getElementById('lr-reflect-count'); if (c) c.innerHTML = reflectCount(el.value);
  var gate = document.getElementById('lr-gate'); if (gate) gate.outerHTML = advanceGate(G.reveal);
}
function journalPrompt(r) {
  var idxRet = r.index[3] / soyIndex() - 1;
  if (G.year === LAST_SERVER_YEAR)
    return 'Twenty-five years. Which of your habits would you keep if this were your real paycheck, and which would you drop?';
  if (G.yr.realShort < -50 || G.yr.realLong < -50)
    return 'You sold at a loss this year. What were you feeling when you hit sell — and would you make that same call again?';
  if (G.yr.realShort > 50)
    return 'You traded actively and paid the higher tax for it. Was the gain worth the taxes — and the hours watching the market?';
  var q4p = {}; TICKERS.forEach(function (t) { q4p[t] = r.prices[t][3]; });
  var net = valueOf(G, q4p, r.index[3]), cashFrac = net > 0 ? G.hys / net : 1;
  if (cashFrac > 0.6 && idxRet > 0.03)
    return 'You kept most of your money safe while the market climbed ' + Math.round(idxRet * 100) + '%. What would it take for you to put more of it to work?';
  if (cashFrac > 0.6)
    return 'You played it safe this year. Did that feel like smart caution, or like sitting on the sidelines?';
  return 'Name one move from this year you would repeat, and one you would change.';
}
function toggleReflected() { G.reflected[G.year] = !G.reflected[G.year]; render(); }
async function commitVerify() {
  if (advancing) return;
  if (!G.emotions[G.year] || !G.reflected[G.year]) return;
  advancing = true;
  var snap = serialize();                 // before destructive year-end (tax, tape, reset)
  G.rumorLog = (G.rumorLog || []).concat((G.reveal.rumors || []).map(function (x) {
    return { y: G.year, q: x.q, t: x.t, text: x.text, truth: !!x.truth, keep: x.keep || 0, mood: G.rumorMoods[x.id] || '' };
  }));
  applyYearEnd(G, G.reveal, G.year + 1);
  try {
    var r = await step();
    if (r === 'error') { Object.assign(G, JSON.parse(snap)); render(); retryNotice(); }  // undo so a retry re-runs year-end cleanly
  } finally { advancing = false; }
}

// ─── Game over ─────────────────────────────────────────────────────────────────
function renderDone() {
  var v = G.valueHistory.length ? G.valueHistory[G.valueHistory.length - 1] : 0;
  var saver = G.saverHistory.length ? G.saverHistory[G.saverHistory.length - 1] : 0;
  var dca = G.dcaHistory.length ? G.dcaHistory[G.dcaHistory.length - 1] : 0;
  var contributed = TUT_PAY * 4 * PRACTICE_YEARS + PAYCHECK_Q * 4 * SERVER_YEARS;
  var feelTl = G.emotions.map(function (e, i) { return e ? '<span class="lr-feelchip">Y' + (i + 1 + PRACTICE_YEARS) + ': ' + e + '</span>' : ''; }).join('');
  var INFLATION = 0.03, inflTarget = 0;
  for (var iy = 1; iy <= TOTAL_YEARS; iy++) {
    var annual = (iy <= PRACTICE_YEARS ? TUT_PAY : PAYCHECK_Q) * 4;
    inflTarget += annual * Math.pow(1 + INFLATION, TOTAL_YEARS - iy);
  }
  inflTarget = round2(inflTarget);
  var lesson;
  if (v > dca) {
    lesson = 'You came out ahead of even a steady, hands-off index this time \u2014 which is rare, and hard to repeat. Notice that just buying in every quarter and holding would have landed close behind (' + money(dca) + '), with none of the second-guessing.';
  } else if (v > saver) {
    lesson = 'Staying invested beat leaving it in savings \u2014 but a plain index you never touched would have done even better (' + money(dca) + '). The picking and the timing quietly cost you.';
  } else {
    lesson = 'Your moves didn\'t beat simply saving this run \u2014 which is exactly why guessing is risky. A plain index you never touched would have grown to ' + money(dca) + ', with no nervous decisions.';
  }
  lesson += ' The real engine was the steady ' + money(PAYCHECK_Q) + ' a quarter, invested and left alone.';
  var inflNote;
  if (saver < inflTarget) {
    inflNote = 'And the catch with playing it safe: at about 3%/yr inflation, your ' + money(contributed) + ' needed to grow to ' + money(inflTarget) + ' just to hold its buying power. Savings only reached ' + money(saver) + ' \u2014 so \u201Cjust saving\u201D actually lost a little real wealth. ' + (v >= inflTarget ? 'What you actually did stayed ahead of inflation \u2014 real, lasting gains.' : 'This run, even your own result didn\u2019t clear that bar.');
  } else {
    inflNote = 'At about 3%/yr inflation, your ' + money(contributed) + ' needed to reach ' + money(inflTarget) + ' to hold its buying power \u2014 and even plain savings (' + money(saver) + ') cleared it. Investing widened the gap.';
  }
  var feelCap = 'Your gut feeling each year \u2014 set it against the climb above. The market\u2019s mood and yours rarely lined up.';
  return '<div class="lr-card">' +
    '<div class="lr-year">25 years later</div>' +
    '<h2>You ended with ' + money(v) + '</h2>' +
    '<p class="lr-muted">You put in ' + money(contributed) + ' of your own money over 25 years: ' + money(TUT_PAY * 4 * PRACTICE_YEARS) + ' in practice, then ' + money(PAYCHECK_Q * 4 * SERVER_YEARS) + ' in the market. The comparisons below start from your practice portfolio in Year 6.</p>' +
    '<table class="lr-final">' +
      '<tr><td><span class="lr-muted">Just to keep pace with inflation (\u22483%/yr)</span></td><td><span class="lr-muted">' + money(inflTarget) + '</span></td></tr>' +
      '<tr><td>If you\'d left it all in savings</td><td>' + money(saver) + '</td></tr>' +
      '<tr><td>If you\'d steadily indexed</td><td>' + money(dca) + '</td></tr>' +
      '<tr><td><strong>What you actually did</strong></td><td><strong>' + money(v) + '</strong></td></tr>' +
    '</table>' +
    sparkline(G.valueHistory, G.dcaHistory) +
    '<p class="lr-lesson">' + lesson + '</p>' +
    '<p class="lr-muted" style="font-size:13px">' + inflNote + '</p>' +
    (feelTl ? '<div class="lr-feeltl"><h4>How the years felt</h4><p class="lr-muted" style="margin:2px 0 8px;font-size:13px">' + feelCap + '</p>' + feelTl + '</div>' : '') +
    '<button class="lr-advance" onclick="openReport()">Print my report for the packet \u2192</button>' +
    '</div>';
}

// ─── News + rumors ───────────────────────────────────────────────────────────
var SIZE_LABEL = { small: 'a little', solid: 'solidly', big: 'a lot' };
function saidTag(said) {
  if (!said) return '';
  var up = said.dir > 0;
  return '<span class="lr-said ' + (up ? 'lr-up' : 'lr-down') + '">' + (up ? '\u25B2 up ' : '\u25BC down ') + SIZE_LABEL[said.size] + '</span>';
}
// Start-of-year forecasts. Same for the whole class. Often wrong on size; in wild years
// some get the direction wrong too. (open=true: the year-open screen's inline panel.)
function forecastBlock(news, open) {
  if (!news || !news.length) return '';
  var items = news.map(function (n) {
    return '<div class="lr-news" onclick="showArticle(\'' + n.t + '\')"><b style="color:' + STOCKS[n.t].color + '">' + n.t + '</b> ' +
      esc(n.headline) + ' ' + saidTag(n.said) + '</div>';
  }).join('');
  return '<div class="lr-newswire"><h4>' + (open ? 'This year\'s forecasts' : 'The forecasts') + '</h4>' + items +
    (open ? '<p class="lr-muted" style="font-size:13px;margin:4px 0 0">Forecasts point the right way more often than not. How far they say it\'ll go is often wrong, and when the market gets wild, some point the wrong way.</p>' : '') +
    '</div>';
}
function showArticle(t) {
  var n = (G.reveal.news || []).filter(function (x) { return x.t === t; })[0]; if (!n) return;
  var m = document.createElement('div'); m.className = 'lr-modal-backdrop';
  m.innerHTML = '<div class="lr-modal"><button class="lr-modal-x" aria-label="Close">&times;</button>' +
    '<div class="lr-modal-tag" style="color:' + STOCKS[t].color + '">' + t + ' · ' + STOCKS[t].name + ' · forecast</div>' +
    '<h3>' + esc(n.headline) + '</h3><p>' + esc(n.article) + '</p><p style="margin-top:10px">' + saidTag(n.said) + '</p></div>';
  m.addEventListener('click', function (e) { if (e.target === m || e.target.className === 'lr-modal-x') m.remove(); });
  document.body.appendChild(m);
}
function verdictTag(r) {
  if (r.truth === undefined) return '<span class="lr-rumor-src">UNVERIFIED</span>';
  return r.truth ? '<span class="lr-true">TRUE</span>' : '<span class="lr-false">FALSE</span>';
}
// One tabloid look for every rumor: masthead, shouty headline, source, and (once known) a stamp.
function tabloidCard(text, src, opts) {
  opts = opts || {};
  var stamp = opts.truth === undefined ? '' :
    '<div class="lr-stamp ' + (opts.truth ? 'lr-stamp-true' : 'lr-stamp-false') + '">' + (opts.truth ? 'CONFIRMED' : 'DEBUNKED') + '</div>';
  return '<div class="lr-rumor' + (opts.truth === undefined ? '' : ' lr-rumor-done') + '">' +
    '<div class="lr-rumor-mast"><span>The Street Tattler</span><span>' + (opts.tag || '★ EXCLUSIVE ★') + '</span></div>' +
    '<div class="lr-rumor-body"><div class="lr-rumor-text">' + esc(text) + '</div>' +
    (src ? '<div class="lr-rumor-src">— ' + esc(src) + (opts.truth === undefined ? ' <span class="lr-unverified">UNVERIFIED</span>' : '') + '</div>' : '') +
    (opts.note ? '<div class="lr-rumor-note">' + opts.note + '</div>' : '') +
    '</div>' + stamp + '</div>';
}
function rumorBlock(rumors) {
  if (!rumors || !rumors.length) return '';
  var cards = rumors.map(function (r) { return tabloidCard(r.text, r.src, { truth: r.truth, tag: 'Q' + (r.q + 1) + ' · EXCLUSIVE' }); }).join('');
  return '<div class="lr-tabloid">' + cards + '</div>';
}
// A rumor that just appeared and hasn't been answered yet.
function pendingRumor() {
  if (!G.reveal || !G.reveal.rumors || !/^q[0-3]$/.test(G.phase)) return null;
  var q = qIndex();
  return G.reveal.rumors.filter(function (r) { return r.q === q && !G.rumorSeen[r.id]; })[0] || null;
}
function rumorModal(r) {
  var btns = EMOTIONS.map(function (e) { return '<button class="lr-emotion" onclick="answerRumor(\'' + r.id + '\',\'' + e + '\')">' + e + '</button>'; }).join('');
  return '<div class="lr-modal-backdrop"><div class="lr-modal lr-modal-news">' +
    '<div class="lr-modal-tag" style="color:#b22222">Breaking \u00B7 Year ' + gameYear() + ', Quarter ' + (r.q + 1) + '</div>' +
    '<div class="lr-tabloid" style="margin:8px 0 14px">' + tabloidCard(r.text, r.src, {}) + '</div>' +
    '<p>' + STOCKS[r.t].name + ' is already moving on it. You\'ll find out next quarter whether it\'s true.</p>' +
    '<div class="lr-feel"><h4>Before you do anything: how does this make you feel?</h4><div class="lr-emotions">' + btns + '</div></div>' +
    '</div></div>';
}
function answerRumor(id, mood) { G.rumorSeen[id] = 1; G.rumorMoods[id] = mood; render(); }
// Quarter screen: rumors whose truth just came out.
function rumorUpdates(r, q) {
  var out = (r.rumors || []).filter(function (x) { return x.q === q - 1 && x.truth !== undefined; }).map(function (x) {
    var note = x.truth ? STOCKS[x.t].name + ' keeps part of that move for good.' : 'False. The jump it caused is gone.';
    return tabloidCard(x.text, x.src, { truth: x.truth, tag: 'Rumor update', note: note });
  }).join('');
  return out ? '<div class="lr-tabloid lr-rumorupdates">' + out + '</div>' : '';
}
// Year end: the forecasts vs. this student's actual market.
function forecastCheck(r) {
  if (!r.news || !r.news.length) return '';
  var rows = r.news.map(function (n) {
    var prev = (G.hist[n.t] && G.hist[n.t].length) ? G.hist[n.t][G.hist[n.t].length - 1] : STARTING_PRICES[n.t];
    var m = r.prices[n.t][3] / prev - 1, a = Math.abs(m);
    var actSize = a < 0.05 ? 'small' : a < 0.15 ? 'solid' : 'big';
    var dirOk = (m >= 0 ? 1 : -1) === n.said.dir, sizeOk = dirOk && actSize === n.said.size;
    var kind = !dirOk ? 'busted' : sizeOk ? 'right' : 'size';
    var verdict = kind === 'busted' ? '<span class="lr-false">wrong way</span>' : kind === 'right' ? '<span class="lr-true">right</span>' : '<span class="lr-said">right way, wrong size</span>';
    // why it missed (same for the class); if a true rumor moved this student's company, say so instead
    var note = '';
    if (n.miss && kind !== n.miss && rumorMovedIt(n.t)) note = 'Your ' + STOCKS[n.t].name + ' moved differently from the class market: a true rumor changed it.';
    else if (n.why && kind !== 'right') note = (n.miss === 'busted' ? '<b>What really happened:</b> ' : '<b>Why it missed:</b> ') + esc(n.why);
    return '<tr' + (note ? ' class="lr-has-note"' : '') + '><td><b style="color:' + STOCKS[n.t].color + '">' + n.t + '</b></td><td>' + saidTag(n.said) + '</td><td class="lr-mono">' + (m >= 0 ? '+' : '−') + Math.round(a * 100) + '%</td><td>' + verdict + '</td></tr>' +
      (note ? '<tr class="lr-fc-note"><td></td><td colspan="3">' + (n.miss === 'busted' && kind === 'busted' ? '<span class="lr-dim">“' + esc(n.headline) + '”</span> ' : '') + note + '</td></tr>' : '');
  }).join('');
  return '<div class="lr-truths"><h4>The forecasts vs. your market</h4><table><thead><tr><th></th><th>Forecast said</th><th>Yours did</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function rumorMovedIt(t) {                 // a true rumor about t has reached this student (any year so far)
  var seen = (G.rumorLog || []).concat(((G.reveal && G.reveal.rumors) || []).map(function (x) { return { t: x.t, truth: x.truth }; }));
  return seen.some(function (x) { return x.t === t && x.truth; });
}
function rumorResults(r) {
  if (!r.rumors || !r.rumors.length) return '<div class="lr-truths"><h4>Rumors this year</h4><p class="lr-muted">None reached you this year.</p></div>';
  var rows = r.rumors.map(function (x) {
    var effect = x.truth ? 'kept ' + (x.keep > 0 ? '+' : '') + x.keep + '% for good' : 'faded';
    return '<tr><td>Q' + (x.q + 1) + '</td><td>' + esc(x.text) + '</td><td>' + verdictTag(x) + '</td><td class="lr-dim">' + effect + '</td><td class="lr-dim">' + esc(G.rumorMoods[x.id] || '') + '</td></tr>';
  }).join('');
  return '<div class="lr-truths"><h4>Rumors this year</h4><table><thead><tr><th></th><th></th><th></th><th>Effect</th><th>You felt</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
}
function storiesBlock(r) {
  if (!r.stories || !r.stories.length) return '';
  var items = r.stories.map(function (s) {
    return '<div class="lr-story"><b style="color:' + STOCKS[s.t].color + '">' + s.t + '</b> ' + esc(s.headline) + '<div class="lr-dim" style="font-size:13px">' + esc(s.article) + '</div></div>';
  }).join('');
  return '<div class="lr-newswire"><h4>What actually happened</h4>' + items + '</div>';
}

// ─── Teacher panel ─────────────────────────────────────────────────────────────
function renderTeacherPanel() {
  return '<div class="lr-card"><h2>Teacher panel — The Long Run</h2>' +
    '<p class="lr-muted">You\'re signed in as a teacher, so you see the class instead of the game. Students never see this.</p>' +
    '<div class="lr-teacher-actions">' +
      '<button onclick="previewAsStudent()">Preview as student →</button>' +
      '<button onclick="resetMyGame()">Reset my game</button>' +
      '<button onclick="loadDashboard()">Refresh</button>' +
    '</div><div id="dashboard"><p class="lr-muted">Loading class progress…</p></div></div>';
}
async function loadDashboard() {
  var el = document.getElementById('dashboard'); if (!el) return;
  try {
    var res = await Server.getClassData();
    if (!res || !res.ok) { el.innerHTML = '<p class="lr-error">' + esc((res && res.error) || 'Could not load.') + '</p>'; return; }
    el.innerHTML = dashboardTable(res.students);
  } catch (e) { el.innerHTML = '<p class="lr-error">' + esc(String(e)) + '</p>'; }
}
var DASH = {};
function dashWhere(s, st) {               // where a student is, in game years
  if (s.phase === 'done') return 'Finished';
  if (Number(s.year) === 0 && s.phase === 'choose' && !st.tutorialDone) {
    var step = st.tp && TUT_STEPS[st.tp.i];
    return 'Practice' + (step && step.y !== undefined ? ' ' + (step.y + 1) : '');
  }
  return 'Year ' + (Number(s.year) + 1 + PRACTICE_YEARS);
}
function dashboardTable(students) {
  if (!students || !students.length) return '<p class="lr-muted">No students have started yet.</p>';
  DASH = {};
  var rows = students.map(function (s) {
    var v = '—', feels = '', nRef = 0;
    try {
      var st = JSON.parse(s.state || '{}');
      DASH[s.email] = st;
      nRef = (st.reflections || []).filter(function (x) { return x && String(x).trim(); }).length;
      if (st.valueHistory && st.valueHistory.length) v = money(st.valueHistory[st.valueHistory.length - 1]);
      if (st.emotions && st.emotions.length) feels = st.emotions.map(function (e) { return e ? e.slice(0, 3) : '·'; }).join(' ');
    } catch (e) {}
    return '<tr><td>' + esc(s.email) + '</td><td>' + dashWhere(s, DASH[s.email] || {}) + '</td><td>' + esc(s.phase) +
      '</td><td>' + v + '</td><td class="lr-feeltrail">' + esc(feels) + '</td>' +
      '<td>' + (nRef ? '<button onclick="showReflections(\'' + jsArg(s.email) + '\')">Read ' + nRef + '</button>' : '<span class="lr-dim">—</span>') +
      ' <button onclick="openReportFor(\'' + jsArg(s.email) + '\',' + (Number(s.year) || 0) + ',\'' + jsArg(s.phase) + '\')">Report</button></td>' +
      '<td>' + fmtDate(s.updatedAt) +
      '</td><td><button onclick="resetStudent(\'' + jsArg(s.email) + '\')">Reset</button></td></tr>';
  }).join('');
  return '<table class="lr-dash"><thead><tr><th>Student</th><th>Progress</th><th>Phase</th><th>Latest value</th><th>Feelings</th><th>Reflections</th><th>Updated</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
}
async function resetStudent(email) {
  if (!confirm('Reset ' + email + ' back to Year 1? This erases their progress.')) return;
  try { var res = await Server.resetStudent(email); if (res && res.ok) loadDashboard(); else showError((res && res.error) || 'Reset failed.'); }
  catch (e) { showError(String(e)); }
}
function showReflections(email) {
  var st = DASH[email] || {}, refl = st.reflections || [], emo = st.emotions || [];
  var items = '';
  for (var i = 0; i < Math.max(refl.length, emo.length); i++) {
    if (!refl[i] && !emo[i]) continue;
    items += '<div class="lr-recap"><h4>Year ' + (i + 1 + PRACTICE_YEARS) + (emo[i] ? ' &middot; felt ' + esc(emo[i]) : '') + '</h4><p>' + (refl[i] ? esc(refl[i]) : '<span class="lr-dim">(no written reflection)</span>') + '</p></div>';
  }
  var tut = st.practice ? '<p class="lr-muted">Practice round: finished at ' + money(st.practice.endValue) + '; at the ShopRight spring bump they chose to <b>' + esc(st.practice.y5) + '</b>.</p>' : '';
  var m = document.createElement('div'); m.className = 'lr-modal-backdrop';
  m.innerHTML = '<div class="lr-modal lr-modal-news"><button class="lr-modal-x" aria-label="Close">&times;</button>' +
    '<div class="lr-modal-tag" style="color:var(--blue)">' + esc(email) + '</div><h3>Reflections</h3>' + tut + (items || '<p class="lr-muted">None yet.</p>') + '</div>';
  m.addEventListener('click', function (e) { if (e.target === m || e.target.className === 'lr-modal-x') m.remove(); });
  document.body.appendChild(m);
}
function fmtDate(d) { try { var x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString(); } catch (e) { return '—'; } }
function previewAsStudent() { G.preview = true; render(); }
function exitPreview() { G.preview = false; render(); }
async function resetMyGame() {
  if (!confirm('Reset YOUR own game back to Year 1? (Students are not affected.)')) return;
  try { localStorage.removeItem(tutKey()); } catch (e) {}
  TP = null;
  try { var res = await Server.resetMe(); if (res && res.ok) { applyBoot(res.boot); render(); } else showError((res && res.error) || 'Reset failed.'); }
  catch (e) { showError(String(e)); }
}

// ─── Summary report (printable; attaches to the packet) ───────────────────────
function openReport() { G.showReport = true; window.scrollTo && window.scrollTo(0, 0); render(); }
function openReportFor(email, year, phase) { G.showReport = { email: email, year: year, phase: phase }; render(); }
function closeReport() { G.showReport = false; render(); }
function renderReportView() {
  var who = G.showReport === true ? { st: G, year: G.year, phase: G.phase, email: ((window.LONGRUN_BOOT || {}).email || '') }
                                  : { st: DASH[G.showReport.email] || {}, year: G.showReport.year, phase: G.showReport.phase, email: G.showReport.email };
  return '<div class="lr-noprint lr-reportbar"><button onclick="closeReport()">← Back</button>' +
    '<button class="lr-pulse" onclick="window.print()">🖨 Print</button></div>' + reportHtml(who.st, who.year, who.phase, who.email);
}
function reportHtml(st, serverYear, phase, email) {
  var vh = st.valueHistory || [], sh = st.saverHistory || [], dh = st.dcaHistory || [];
  var emo = st.emotions || [], refl = st.reflections || [], pr = st.practice;
  var finished = phase === 'done';
  var reached = finished ? 'Finished all ' + TOTAL_YEARS + ' years' : (pr || vh.length ? 'Working on Year ' + (serverYear + 1 + PRACTICE_YEARS) + ' of ' + TOTAL_YEARS : 'Still in the practice round');
  var h = '<div class="lr-report">' +
    '<h1>The Long Run — my report</h1>' +
    '<p class="lr-rep-name">Name: <span></span></p>' +
    '<p class="lr-rep-meta">' + esc(email) + ' · printed ' + new Date().toLocaleDateString() + ' · ' + reached + '</p>';
  // practice
  h += '<h2>Practice round (Years 1–5)</h2>';
  if (pr) {
    h += '<p>Ended practice with <b>' + money2(pr.endValue) + '</b> from ' + money(TUT_PAY * 4 * PRACTICE_YEARS) + ' put in. At ShopRight\'s spring bump I chose to <b>' + esc(pr.y5) + '</b>.</p><table class="lr-rep-tbl"><tr><th>Practice year</th><th>Felt</th><th>What I wrote</th></tr>';
    for (var y = 0; y < 5; y++) h += '<tr><td>' + (y + 1) + ' · ' + TUT_STOCKS[y] + '</td><td>' + esc((pr.moods || {})['y' + y] || '') + '</td><td>' + esc(((pr.recaps || {})[y] || {}).text || '') + '</td></tr>';
    h += '</table>';
  } else h += '<p class="lr-rep-empty">Not finished yet.</p>';
  h += '<h3>The five rules I took from practice</h3><ol><li>Did the business change, or just the headline?</li><li>Steady income is worth keeping; boring can be good.</li><li>Already spiked + everyone excited = you\'re probably late.</li><li>A rumor isn\'t a fact. Wait for confirmation.</li><li>Know the normal rhythm; don\'t flinch at the expected.</li></ol>';
  // the real market, year by year
  h += '<h2>The market (Years 6–25)</h2>';
  if (vh.length) {
    h += '<table class="lr-rep-tbl"><tr><th>Year</th><th>Ended with</th><th>Just saving</th><th>Steady index</th><th>Felt</th><th>What I wrote</th></tr>';
    for (var i = 0; i < vh.length; i++) {
      h += '<tr><td>' + (i + 1 + PRACTICE_YEARS) + '</td><td>' + money(vh[i]) + '</td><td>' + money(sh[i] || 0) + '</td><td>' + money(dh[i] || 0) + '</td><td>' + esc(emo[i] || '') + '</td><td>' + esc(refl[i] || '') + '</td></tr>';
    }
    h += '</table>';
    var last = vh.length - 1, gap = vh[last] - (sh[last] || 0);
    h += '<p>' + (finished ? 'Final result: ' : 'So far: ') + '<b>' + money(vh[last]) + '</b>. That\'s ' + money(Math.abs(gap)) + (gap >= 0 ? ' ahead of' : ' behind') + ' just saving, and ' +
      money(Math.abs(vh[last] - (dh[last] || 0))) + (vh[last] >= (dh[last] || 0) ? ' ahead of' : ' behind') + ' steadily buying the index.</p>';
  } else h += '<p class="lr-rep-empty">No market years finished yet.</p>';
  // rumors
  var rl = st.rumorLog || [];
  h += '<div class="lr-rep-keep"><h2>Rumors that reached me</h2>';
  if (rl.length) {
    var nt = rl.filter(function (r) { return r.truth; }).length;
    h += '<p>' + rl.length + ' rumors: ' + nt + ' true, ' + (rl.length - nt) + ' false.</p><table class="lr-rep-tbl"><tr><th>Year</th><th>Rumor</th><th>Truth</th><th>I felt</th></tr>';
    rl.forEach(function (r) { h += '<tr><td>' + (r.y + 1 + PRACTICE_YEARS) + ' Q' + (r.q + 1) + '</td><td>' + esc(r.text) + '</td><td>' + (r.truth ? 'TRUE' : 'FALSE') + '</td><td>' + esc(r.mood) + '</td></tr>'; });
    h += '</table>';
  } else h += '<p class="lr-rep-empty">None yet.</p>';
  h += '</div>';
  return h + '</div>';
}

// ─── tiny inline charts ─────────────────────────────────────────────────────
function chgTag(diff, isMoney) {
  var cls = diff > 0 ? 'lr-up' : diff < 0 ? 'lr-down' : 'lr-flat';
  var arrow = diff > 0 ? '▲' : diff < 0 ? '▼' : '·';
  var mag = isMoney ? money(Math.abs(diff)) : Math.abs(diff).toFixed(1);
  return '<span class="lr-chg ' + cls + '">' + arrow + ' ' + (diff > 0 ? '+' : '') + mag + '</span>';
}
function priceSpark(arr, color) {
  var W = 64, H = 22, pad = 2;
  if (!arr || arr.length < 2) return '<svg class="lr-pricespark" width="' + W + '" height="' + H + '"></svg>';
  var max = Math.max.apply(null, arr), min = Math.min.apply(null, arr), n = arr.length, span = max - min || 1;
  function px(i) { return (pad + (i / (n - 1)) * (W - 2 * pad)).toFixed(1); }
  function py(v) { return ((H - pad) - ((v - min) / span) * (H - 2 * pad)).toFixed(1); }
  var d = arr.map(function (v, i) { return (i ? 'L' : 'M') + px(i) + ' ' + py(v); }).join(' ');
  return '<svg class="lr-pricespark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">' +
    '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>' +
    '<circle cx="' + px(n - 1) + '" cy="' + py(arr[n - 1]) + '" r="1.9" fill="' + color + '"/></svg>';
}
function sparkline(a, b) {
  var all = a.concat(b); if (!all.length) return '';
  var max = Math.max.apply(null, all), min = Math.min.apply(null, all), W = 320, H = 70, n = Math.max(a.length, b.length);
  function path(arr) {
    if (arr.length < 2) return '';
    return arr.map(function (y, i) { var x = (i / (n - 1)) * W, yy = H - ((y - min) / (max - min || 1)) * H; return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + yy.toFixed(1); }).join(' ');
  }
  return '<svg class="lr-spark" viewBox="0 0 ' + W + ' ' + H + '" width="100%" height="' + H + '">' +
    '<path d="' + path(b) + '" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="4 3"/>' +
    '<path d="' + path(a) + '" fill="none" stroke="#22c55e" stroke-width="2"/></svg>';
}

function jsArg(s) {   // a value placed inside onclick="f('...')": JS-escape, then HTML-escape
  return esc(String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'")).replace(/"/g, '&quot;');
}
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function showError(msg) { var a = document.getElementById('app'); if (a) a.insertAdjacentHTML('afterbegin', '<div class="lr-error">' + esc(msg) + '</div>'); }

// ═══════════════════════════════════════════════════════════════════════════
// PRACTICE ROUND — "Learning the Ropes" (5 scripted years before the real game)
//
// Spec: long-run/docs/PROLOGUE_SPEC.md. On rails and identical for everyone:
// one company per year, the coach tells the student exactly what to tap
// (including four classic mistakes, on purpose), then a year-end recap names
// the fault, shows what it cost with the student's actual numbers, and gives
// the rule to carry forward. Year 5 hands the student the big call.
//
// Practice money stays in practice: the real game starts at $0 as always, so
// every real-game benchmark is untouched. Nothing here talks to the server.
// Progress within the practice round is kept in this browser (localStorage);
// tutorialDone rides into the save blob on the first real Advance.
// ═══════════════════════════════════════════════════════════════════════════
var TUT_STOCKS = ['MED', 'TBK', 'NVT', 'PPK', 'SHP'];      // spotlight order, one per year
var TUT_PAY = 100;                                         // practice paycheck per quarter
var TUT_PRICES = [                                         // [year][quarter] -> prices
  [{MED: 92, TBK: 55, NVT: 52, PPK: 44, SHP: 32}, {MED: 80, TBK: 56, NVT: 55, PPK: 45, SHP: 32}, {MED: 90, TBK: 57, NVT: 58, PPK: 46, SHP: 33}, {MED: 88, TBK: 58, NVT: 60, PPK: 46, SHP: 33}],
  [{MED: 90, TBK: 60, NVT: 62, PPK: 47, SHP: 33}, {MED: 92, TBK: 62, NVT: 64, PPK: 47, SHP: 34}, {MED: 94, TBK: 63, NVT: 66, PPK: 48, SHP: 34}, {MED: 96, TBK: 65, NVT: 68, PPK: 48, SHP: 34}],
  [{MED: 98, TBK: 66, NVT: 70, PPK: 49, SHP: 34}, {MED: 100, TBK: 68, NVT: 96, PPK: 49, SHP: 35}, {MED: 102, TBK: 69, NVT: 86, PPK: 50, SHP: 35}, {MED: 104, TBK: 70, NVT: 84, PPK: 50, SHP: 35}],
  [{MED: 106, TBK: 71, NVT: 87, PPK: 50, SHP: 35}, {MED: 108, TBK: 73, NVT: 90, PPK: 76, SHP: 35}, {MED: 110, TBK: 74, NVT: 92, PPK: 52, SHP: 36}, {MED: 112, TBK: 75, NVT: 94, PPK: 60, SHP: 36}],
  [{MED: 114, TBK: 76, NVT: 95, PPK: 62, SHP: 36}, {MED: 116, TBK: 78, NVT: 97, PPK: 65, SHP: 39}, {MED: 118, TBK: 79, NVT: 98, PPK: 67, SHP: 37}, {MED: 120, TBK: 80, NVT: 100, PPK: 70, SHP: 40}]
];
// Practice Year 5 closes on the real game's Year 1 starting prices (STARTING_PRICES).

// Dividends: $/share paid at the START of a quarter, to whoever holds the stock.
function tutDivs(y, q) {
  var d = {};
  if (q === 2 && y >= 1) d.TBK = 1.00;      // TrustBank pays every Q3 from Practice Year 2 on
  if (y === 4 && q === 3) d.SHP = 0.50;     // ShopRight's holiday-quarter dividend
  return d;
}

function money2(x) { return '$' + Number(x).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function signed2(x) { return (x >= 0 ? '+' : '−') + money2(Math.abs(x)); }

// The script. act: {buy:amt} | {sell:1} | 'choice' | null (hold: just press Next).
// coach/after may be functions of the practice state T (numbers are always computed).
var TUT_Q = [
  [ // ── Practice Year 1 · MED · the whipsaw ──
    { head: 'MedCo Reports Another Steady Quarter', act: { buy: 100 },
      coach: 'Your first $100 paycheck just landed in savings. Put it to work: tap <b>+$100</b> on MedCo.',
      after: function (T) { return 'You now own ' + T.sh('MED').toFixed(2) + ' shares of MedCo &mdash; a small piece of the company. If MedCo does well, your piece is worth more.'; } },
    { head: 'MedCo Under Regulatory Review &mdash; Shares Slide', act: { sell: 1 },
      coach: 'Yikes. MedCo fell from $92 to <b>$80</b> on a scary headline. Your gut says get out before it gets worse. Tap <b>Sell all</b>.',
      after: function (T) { return 'You sold at $80 and got back ' + money2(T.y1sold) + ' for the $100 you put in. That ' + money2(100 - T.y1sold) + ' loss is now locked in for good. Notice what did <i>not</i> change: MedCo\'s business. Only the headline did.'; } },
    { head: 'Review Cleared &mdash; MedCo Bounces Back', act: { buy: 200 },
      coach: 'MedCo is back up to <b>$90</b> and you\'re not in it. It feels like you\'re missing out. Tap <b>+$200</b> to jump back in.',
      after: function () { return 'You bought back in at $90 &mdash; $10 a share <i>more</i> than you sold for one quarter ago. Sold low, bought high: the exact wrong order.'; } },
    { head: 'MedCo Settles Into a Steady Close', act: { buy: 100 },
      coach: 'It settled a little lower, at <b>$88</b>. Lesson learned &mdash; this time you buy and hold. Tap <b>+$100</b>.',
      after: function (T) { return 'You\'re carrying ' + T.sh('MED').toFixed(2) + ' shares of MedCo into next year. Next: what the round trip cost you.'; } }
  ],
  [ // ── Practice Year 2 · TBK · paid to hold ──
    { head: 'TrustBank Lending Grows Steadily', act: { buy: 100 },
      coach: 'This year is about TrustBank. Tap <b>+$100</b> on TrustBank.',
      after: function (T) { return 'You own ' + T.sh('TBK').toFixed(2) + ' shares of TrustBank. Your MedCo shares are still yours &mdash; they\'re only locked because this year is TrustBank\'s.'; } },
    { head: 'TrustBank Edges Higher', act: { buy: 100 },
      coach: 'Still steady, still growing. Add to it: tap <b>+$100</b>.',
      after: function (T) { return 'Now ' + T.sh('TBK').toFixed(2) + ' shares. Watch your savings next quarter.'; } },
    { head: 'TrustBank Pays Its Quarterly Dividend', act: null,
      coach: function (T) { return 'Look at your savings. TrustBank just paid you <b>' + money2(T.lastDiv) + '</b> &mdash; you didn\'t sell anything. That\'s a <b>dividend</b>: cash for owning the stock. Nothing to tap. Press <b>Next quarter</b>.'; } },
    { head: 'A Quiet Quarter at TrustBank', act: null,
      coach: 'Nothing\'s happening. Boring. It\'s tempting to sell and chase something exciting. Don\'t &mdash; just press <b>Next quarter</b>.' }
  ],
  [ // ── Practice Year 3 · NVT · chasing the hype ──
    { head: 'NovaTech\'s New Platform Picks Up Users', act: { buy: 100 },
      coach: 'Meet NovaTech. Tap <b>+$100</b>.',
      after: function () { return 'Bought at $70. Now hold on.'; } },
    { head: 'NovaTech Is EVERYWHERE &mdash; Up 37% in Three Months!', act: { buy: 200 },
      coach: 'Everyone is talking about NovaTech. It jumped from $70 to <b>$96</b>. Don\'t miss out! Tap <b>+$200</b>.',
      after: function () { return 'You bought at $96 &mdash; <i>after</i> the jump. The good news was already baked into the price.'; } },
    { head: 'NovaTech Cools as the Buzz Fades', act: null,
      coach: 'The buzz faded, and so did the price: <b>$86</b>. Hold &mdash; press <b>Next quarter</b>.' },
    { head: 'NovaTech Steadies Below Its Peak', act: null,
      coach: 'NovaTech settles at <b>$84</b>. Hold &mdash; press <b>Next quarter</b>.' }
  ],
  [ // ── Practice Year 4 · PPK · the false rumor ──
    { head: 'PetroPeak Holds Steady', act: { buy: 100 },
      coach: 'Meet PetroPeak, an energy company. Tap <b>+$100</b>.',
      after: function () { return 'Bought at $50.'; } },
    { rumor: 'PETROPEAK SITTING ON A SECRET MEGA-FIELD?!', src: 'an anonymous oil worker', act: { buy: 200 },
      coach: 'A rumor says PetroPeak found a giant oil field. The price shot to <b>$76</b>. Tap <b>+$200</b> &mdash; before it\'s too late!',
      after: function () { return 'You just bought on a rumor. Nobody has confirmed it. Look at the tag on it: <b>UNVERIFIED</b>.'; } },
    { verdict: 'The mega-field rumor was FALSE. "There is no new field," PetroPeak says.', act: null,
      coach: 'The rumor was false. PetroPeak crashed to <b>$52</b>. Hold &mdash; press <b>Next quarter</b>.' },
    { head: 'PetroPeak Recovers Some Ground', act: null,
      coach: 'It climbed back to <b>$60</b>, still well below where you bought on the rumor. Hold &mdash; press <b>Next quarter</b>.' }
  ],
  [ // ── Practice Year 5 · SHP · your call ──
    { head: 'ShopRight Opens the Year Quietly', act: { buy: 200 },
      coach: 'Meet ShopRight, a store chain. Tap <b>+$200</b>.',
      after: function (T) { return 'You own ' + T.sh('SHP').toFixed(2) + ' shares of ShopRight.'; } },
    { head: 'Tax-Refund Season Lifts ShopRight\'s Spring Sales', act: 'choice',
      coach: 'ShopRight jumped from $36 to <b>$39</b>. Shoppers are spending their tax refunds, like they do most springs. <b>This one is your call:</b> tap <b>Sell all</b> to lock in the gain, or <b>Hold</b>.',
      after: function (T) {
        return T.y5sold
          ? 'You sold at $39 for ' + money2(T.y5sold) + '. Let\'s see whether that bump was real news or just the calendar.'
          : 'You held. A refund-season bump comes around every spring &mdash; it\'s the calendar, not news.';
      } },
    { head: 'ShopRight Sales Return to Normal', act: null,
      coach: 'Refund season is over, and ShopRight is back to <b>$37</b>. Press <b>Next quarter</b>.' },
    { head: 'Holiday Shopping Lifts ShopRight; Dividend Paid', act: null,
      coach: function (T) {
        return T.y5sold
          ? 'Holiday season: ShopRight finishes at <b>$40</b> and pays its dividend to everyone who still owns it. Press <b>Next quarter</b>.'
          : 'Holiday season: ShopRight finishes at <b>$40</b> and pays you a <b>' + money2(T.lastDivBy.SHP || 0) + '</b> dividend. Press <b>Next quarter</b>.';
      } }
  ]
];

var TUT_INTRO = [
  { title: 'MedCo (MED) &middot; Healthcare',
    body: '<p>People need medical care in good times and bad, so MedCo tends to be <b>steady</b>.</p>' +
      '<p><b>How to read a stock card:</b></p><ul class="lr-tut-list">' +
      '<li><b>The price</b> is what one share costs right now.</li>' +
      '<li><b>The arrow</b> shows how much it moved since last quarter.</li>' +
      '<li><b>The little chart</b> is its price history.</li>' +
      '<li><b>+$100 / +$200</b> buy from your savings. <b>Sell all</b> turns your shares back into savings.</li></ul>' +
      '<p>This year only MedCo\'s buttons work. The other companies are locked until their year.</p>' },
  { title: 'TrustBank (TBK) &middot; Banking',
    body: '<p>TrustBank is a bank: steady, and it pays a <b>dividend</b> &mdash; cash it pays its owners every so often, just for holding the stock. The green <span class="lr-divtag">DIV</span> tag marks companies that pay one.</p>' +
      '<p>You still own your MedCo shares. They\'re locked, not gone.</p>' },
  { title: 'NovaTech (NVT) &middot; Technology',
    body: '<p>NovaTech is exciting and fast-moving, and it pays no dividend. When tech is hot, <b>everyone</b> talks about it.</p>' },
  { title: 'PetroPeak (PPK) &middot; Energy',
    body: '<p>Energy companies swing hard: with oil prices, and with <b>rumors</b>. In the real game, rumors come from <i>The Street Tattler</i>, and they are marked <b>UNVERIFIED</b> until the year-end screen says whether they were true.</p>' },
  { title: 'ShopRight (SHP) &middot; Retail',
    body: '<p>Stores have <b>seasons</b>: spring tax-refund shopping, back-to-school, the holidays. ShopRight pays a small dividend.</p>' +
      '<p><b>This year the coach won\'t tell you what to do at the big moment. You decide.</b></p>' }
];

// Steps: welcome, then per year [intro, q0(+after), q1(+after), ..., recap], then final.
var TUT_STEPS = (function () {
  var s = [{ k: 'welcome' }];
  for (var y = 0; y < 5; y++) {
    s.push({ k: 'intro', y: y });
    for (var q = 0; q < 4; q++) {
      s.push({ k: 'q', y: y, q: q });
      if (TUT_Q[y][q].act) s.push({ k: 'after', y: y, q: q });
    }
    s.push({ k: 'recap', y: y });
  }
  s.push({ k: 'final' });
  return s;
})();

// ── progress (this browser only) ──
function tutKey() { var b = (typeof window !== 'undefined' && window.LONGRUN_BOOT) || {}; return 'lr-tut3:' + (b.email || 'anon'); }
function tutLoad() {
  var v = null, srv = (G && G.tp && typeof G.tp.i === 'number') ? G.tp : null;
  try { v = JSON.parse(localStorage.getItem(tutKey()) || 'null'); } catch (e) {}
  if (!(v && typeof v.i === 'number')) v = null;
  if (srv && (!v || srv.i > v.i)) v = JSON.parse(JSON.stringify(srv));   // further along on another computer
  return v || { i: 0, choice: null, done: false, moods: {}, recaps: {} };
}
// Checkpoint to the server at the end of each practice year (fire and forget:
// this browser's copy is the fallback). Lets a student switch computers.
function tutCheckpoint() {
  if (!Server.available || !Server.savePractice) return;
  G.tp = TP.done ? null : TP;
  try { Server.savePractice(serialize()).catch(function () {}); } catch (e) {}
}
function tutSave(P) { try { localStorage.setItem(tutKey(), JSON.stringify(P)); } catch (e) {} }
var TP = null;   // { i, choice, done }

function tutorialPending() {
  if (!G || G.phase !== 'choose' || G.year !== 0 || G.tutorialDone) return false;
  if (G.lastCreditedQ >= 0 || (G.valueHistory && G.valueHistory.length)) return false;   // already playing
  if (!TP) TP = tutLoad();
  if (TP.done) { applyCarry(TP.result); return false; }   // finished in this browser; not yet saved by an Advance
  return true;
}

// ── replay the script up to step i -> the practice portfolio ──
function tutState(i, choice) {
  var T = { hys: 0, lots: {}, cost: {}, put: 0, lastDiv: 0, lastDivBy: {}, divYear: {}, y1sold: 0, y5sold: 0, y5choice: choice,
            sh: function (t) { return T.lots[t] || 0; } };
  TUT_STOCKS.forEach(function (t) { T.lots[t] = 0; T.cost[t] = 0; });
  for (var k = 1; k <= i && k < TUT_STEPS.length; k++) {
    var s = TUT_STEPS[k];
    if (s.k === 'q') {                                  // entering a quarter: paycheck + dividends
      T.hys += TUT_PAY; T.put += TUT_PAY;
      var d = tutDivs(s.y, s.q); T.lastDiv = 0; T.lastDivBy = {};
      for (var t in d) { var amt = T.lots[t] * d[t]; if (amt > 0) { T.hys += amt; T.lastDiv += amt; T.lastDivBy[t] = amt; T.divYear[s.y] = (T.divYear[s.y] || 0) + amt; } }
    } else if (s.k === 'after') {                       // the action taken on the quarter before it
      var a = TUT_Q[s.y][s.q].act, tk = TUT_STOCKS[s.y], px = TUT_PRICES[s.y][s.q][tk];
      if (a === 'choice') a = (choice === 'sell') ? { sell: 1 } : null;
      if (a && a.buy) { var spend = Math.min(a.buy, T.hys); T.lots[tk] += spend / px; T.hys -= spend; T.cost[tk] += spend; }
      if (a && a.sell) {
        var got = T.lots[tk] * px; T.hys += got; T.lots[tk] = 0; T.cost[tk] = 0;
        if (s.y === 0) T.y1sold = got;
        if (s.y === 4) T.y5sold = got;
      }
    }
  }
  return T;
}
function tutPrices(y, q) { return TUT_PRICES[y][q]; }
function tutValue(T, y, q) { var p = tutPrices(y, q), v = T.hys; TUT_STOCKS.forEach(function (t) { v += T.lots[t] * p[t]; }); return v; }
function tutHistory(t, y, q) {      // every practice quarter so far, for the little chart
  var a = []; for (var yy = 0; yy <= y; yy++) for (var qq = 0; qq < 4; qq++) { if (yy === y && qq > q) break; a.push(TUT_PRICES[yy][qq][t]); }
  return a;
}

// ── actions ──
function tutNext() {
  var leaving = TUT_STEPS[TP.i];
  TP.i = Math.min(TP.i + 1, TUT_STEPS.length - 1); tutSave(TP);
  if (leaving && leaving.k === 'recap') tutCheckpoint();
  window.scrollTo && window.scrollTo(0, 0); render();
}
function tutAct(kind) {
  var s = TUT_STEPS[TP.i]; if (!s || s.k !== 'q') return;
  var a = TUT_Q[s.y][s.q].act; if (!a) return;
  if (a === 'choice') { if (kind !== 'sell' && kind !== 'hold') return; TP.choice = kind; }
  else if (!((a.buy && kind === 'buy' + a.buy) || (a.sell && kind === 'sell'))) return;   // only the asked-for button counts
  TP.i += 1; tutSave(TP); render();
}
function tutFinish() {
  var T = tutState(TUT_STEPS.length - 1, TP.choice), lots = {};
  TUT_STOCKS.forEach(function (t) { if (T.lots[t] > 1e-9) lots[t] = { sh: T.lots[t], px: T.cost[t] / T.lots[t] }; });
  TP.result = {
    endValue: round2(tutValue(T, 4, 3)), hys: round2(T.hys), lots: lots, y5: TP.choice || 'hold',
    moods: TP.moods || {}, recaps: TP.recaps || {}
  };
  TP.done = true; tutSave(TP);
  applyCarry(TP.result);
  tutCheckpoint();
  window.scrollTo && window.scrollTo(0, 0);
  render();
}
// The practice portfolio becomes the Year 6 portfolio; the comparison lines start from it too.
function applyCarry(res) {
  G.tutorialDone = true; G.tp = null;
  if (!res) return;
  G.practice = res;
  G.tutorial = { endValue: res.endValue, y5: res.y5 };
  if (G.lastCreditedQ >= 0 || (G.valueHistory && G.valueHistory.length)) return;   // never twice
  G.hys = res.hys;
  G.lots = emptyLots();
  for (var t in res.lots) G.lots[t] = [{ sh: res.lots[t].sh, px: res.lots[t].px, yr: 0 }];
  G.startStake = res.endValue;
  G.saverHys = res.endValue;                    // "if you'd just saved": the same stake, in savings
  G.dcaUnits = res.endValue / 100;              // "if you'd steadily indexed": the same stake, in the index (100 at Year 6)
  G.dcaDivCash = 0;
}
function tutSkip() { if (G.isTeacher) { TP.i = TUT_STEPS.length - 1; tutFinish(); } }      // teacher testing only

// ── rendering ──
function tutChrome(y, T, label) {
  var segs = ''; for (var i = 0; i < 5; i++) segs += '<span class="lr-seg lr-seg-' + (i < y ? 'done' : i === y ? 'now' : 'future') + '"></span>';
  return '<div class="lr-chrome"><div class="lr-topbar">' +
    '<div class="lr-actions"><span class="lr-tut-badge">Practice round</span></div>' +
    '<div class="lr-yearpill">Practice ' + (y + 1) + '</div>' +
    '<div class="lr-port"><span class="lr-port-label">Portfolio</span><span class="lr-port-val">' + money(T ? tutValue(T, y, label.q) : 0) + '</span></div>' +
    '</div><div class="lr-rule"></div><div class="lr-progress">' + segs + '</div>' +
    '<div class="lr-phaselabel">' + label.text + '</div></div>';
}
function tutCard(t, y, q, T, step) {
  var spot = (TUT_STOCKS[y] === t), meta = STOCKS[t], px = tutPrices(y, q)[t];
  var prev = q > 0 ? tutPrices(y, q - 1)[t] : (y > 0 ? tutPrices(y - 1, 3)[t] : null);
  var hist = tutHistory(t, y, q), sh = T.lots[t];
  var pays = (t === 'TBK' || t === 'SHP');
  var a = TUT_Q[y][q].act, live = spot && step.k === 'q';
  function b(label, kind, wanted) {
    return '<button' + (live && wanted ? ' class="lr-pulse"' : '') + (live && wanted ? '' : ' disabled') +
      ' onclick="tutAct(\'' + kind + '\')">' + label + '</button>';
  }
  var btns = '';
  if (spot) {
    var isChoice = (a === 'choice');
    btns = b('+$100', 'buy100', a && a.buy === 100) + b('+$200', 'buy200', a && a.buy === 200) +
      b('Sell all', 'sell', (a && a.sell) || isChoice) + (isChoice ? b('Hold', 'hold', true) : '');
  }
  return '<div class="lr-instr' + (spot ? ' lr-spot' : ' lr-locked') + '">' +
    '<div class="lr-instr-head"><span class="lr-instr-name"><b style="color:' + meta.color + '">' + t + '</b> <span class="lr-dim">' + meta.name + '</span></span>' +
      (pays ? '<span class="lr-divtag">DIV</span>' : '') + (spot ? '' : '<span class="lr-lockchip">Locked this year</span>') + '</div>' +
    '<div class="lr-instr-price"><span class="lr-price">' + money(px) + '</span>' + (prev == null ? '<span class="lr-chg lr-flat">&middot;</span>' : chgTag(px - prev, true)) + '</div>' +
    '<div class="lr-instr-sparks"><div class="lr-sparkcell"><span class="lr-sparklabel">History</span>' + priceSpark(hist, netColor(hist)) + '</div></div>' +
    '<div class="lr-instr-hold">' + (sh > 1e-9 ? 'You hold ' + sh.toFixed(2) + ' sh &middot; ' + money2(sh * px) : '<span class="lr-dim">Not held</span>') + '</div>' +
    (spot ? '<div class="lr-instr-actions">' + btns + '</div>' : '') +
    '</div>';
}
function tutNewsItem(y, q) {
  var Q = TUT_Q[y][q], t = TUT_STOCKS[y];
  if (Q.rumor) return '<div class="lr-tabloid">' + tabloidCard(Q.rumor, Q.src, {}) + '</div>';
  if (Q.verdict) {
    var orig = TUT_Q[y].slice(0, q).filter(function (x) { return x.rumor; }).pop();
    return '<div class="lr-tabloid">' + tabloidCard(orig ? orig.rumor : 'RUMOR', orig ? orig.src : '', { truth: false, tag: 'Rumor update', note: Q.verdict }) + '</div>';
  }
  return '<div class="lr-newswire"><div class="lr-news" style="cursor:default"><b style="color:' + STOCKS[t].color + '">' + t + '</b> ' + Q.head + '</div></div>';
}
function tutQuarter(step) {
  var y = step.y, q = step.q, T = tutState(TP.i, TP.choice), Q = TUT_Q[y][q];
  var after = (step.k === 'after');
  var coach = after ? Q.after(T) : (typeof Q.coach === 'function' ? Q.coach(T) : Q.coach);
  var pay = '+' + money(TUT_PAY) + ' paycheck landed in savings' + (T.lastDiv > 0 ? ' &middot; +' + money2(T.lastDiv) + ' in dividends' : '');
  var moodKey = 'm' + TP.i, mood = (TP.moods || {})[moodKey];
  var canNext = (after && !!mood) || !Q.act;
  var nextLabel = q < 3 ? 'Next quarter &rarr;' : 'See how Practice Year ' + (y + 1) + ' went &rarr;';
  var spot = TUT_STOCKS[y];
  var locked = TUT_STOCKS.filter(function (t) { return t !== spot; }).map(function (t) {
    var px = tutPrices(y, q)[t], prev = q > 0 ? tutPrices(y, q - 1)[t] : (y > 0 ? tutPrices(y - 1, 3)[t] : null), sh = T.lots[t];
    return '<div class="lr-lockrow"><span><b style="color:' + STOCKS[t].color + '">' + t + '</b> <span class="lr-dim">' + STOCKS[t].name + '</span></span>' +
      '<span class="lr-price">' + money(px) + ' ' + (prev == null ? '' : chgTag(px - prev, true)) + '</span>' +
      '<span class="lr-lockheld">' + (sh > 1e-9 ? sh.toFixed(2) + ' sh &middot; ' + money2(sh * px) : '<span class="lr-dim">not held</span>') + '</span></div>';
  }).join('');
  return tutChrome(y, T, { q: q, text: 'Learning the ropes' }) +
    '<div class="lr-card">' +
    '<div class="lr-year">Practice Year ' + (y + 1) + ' &middot; Quarter ' + (q + 1) + '</div>' +
    '<p class="lr-muted" style="margin-top:0">' + pay + '</p>' +
    tutNewsItem(y, q) +
    '<div class="lr-standing">' +
      '<div><span class="lr-dim">Savings</span><strong>' + money2(T.hys) + '</strong></div>' +
      '<div><span class="lr-dim">Net worth</span><strong>' + money2(tutValue(T, y, q)) + '</strong></div>' +
      '<div><span class="lr-dim">You\'ve put in</span><strong>' + money(T.put) + '</strong></div>' +
    '</div>' +
    '<div class="lr-coach' + (after ? ' lr-coach-after' : '') + '"><span class="lr-coach-tag">' + (after ? 'What just happened' : 'Coach') + '</span><p>' + coach + '</p>' +
      (after ? tutMoodPick(moodKey, 'How do you feel about that move?') : '') + '</div>' +
    tutCard(spot, y, q, T, step) +
    '<button class="lr-advance"' + (canNext ? '' : ' disabled') + ' onclick="tutNext()">' + (canNext ? nextLabel : (after ? '&uarr; Tap how you feel first' : Q.act === 'choice' ? '&uarr; Make your call first' : '&uarr; Do what the coach says first')) + '</button>' +
    '<div class="lr-lockedlist"><h4>Your other companies &middot; locked until their year</h4>' + locked + '</div>' +
    '</div>';
}
function tutRecapContent(y, T) {
  var p = function (yy, qq, t) { return TUT_PRICES[yy][qq][t]; };
  if (y === 0) {
    var firstSh = 100 / p(0, 0, 'MED'), heldV = firstSh * p(0, 3, 'MED'), endV = tutValue(T, 0, 3);
    return {
      name: 'MedCo &middot; the whipsaw',
      what: 'A scary headline knocked MedCo from $92 to $80, and you sold. When it bounced back to $90, you bought back in.',
      cost: 'You sold your first $100 of MedCo for ' + money2(T.y1sold) + ', so ' + money2(100 - T.y1sold) + ' was gone for good. Then you paid $90 a share to get back in, $10 more than you sold for. ' +
        'If you had simply held that first $100, it would be worth ' + money2(heldV) + ' at the year-end price of $88. ' +
        'You put in ' + money(T.put) + ' this year and ended it with ' + money2(endV) + ' (' + signed2(endV - T.put) + ').',
      rule: 'Before you sell on bad news, ask: <b>did the business change, or just the headline?</b> MedCo\'s business never changed. Only the headline and your nerves did. Selling on noise and buying back on relief usually hands money to the market.'
    };
  }
  if (y === 1) {
    var divs = T.divYear[1] || 0;
    var tbkCost = 200, tbkNow = T.lots.TBK * p(1, 3, 'TBK');
    return {
      name: 'TrustBank &middot; paid to hold',
      what: 'You bought TrustBank and held it through a boring year. You never sold.',
      cost: 'TrustBank paid you ' + money2(divs) + ' in dividends &mdash; cash for doing nothing. Its price also rose from $60 to $65, so your $' + tbkCost + ' of TrustBank is worth ' + money2(tbkNow) + ' plus the dividend. ' +
        'In the real game your paycheck is ten times bigger, so the same habit pays ten times as much.',
      rule: '<b>Boring can be good.</b> "Nothing\'s happening" is not a reason to sell a company that is quietly paying you. Chasing excitement somewhere else can mean leaving that income behind.'
    };
  }
  if (y === 2) {
    var calmSh = 100 / p(2, 0, 'NVT'), hypeSh = 200 / p(2, 1, 'NVT'), close = p(2, 3, 'NVT');
    return {
      name: 'NovaTech &middot; chasing the hype',
      what: 'NovaTech was all over the news after jumping from $70 to $96, and you bought more right at the top.',
      cost: 'Your calm $100 from Quarter 1 is worth ' + money2(calmSh * close) + ' (' + signed2(calmSh * close - 100) + '). Your $200 hype buy is worth ' + money2(hypeSh * close) + ' (' + signed2(hypeSh * close - 200) + '). ' +
        'Same company, same year. The only difference is <i>when</i> you bought.',
      rule: 'When a stock is everywhere and has already jumped, the easy gains are usually gone &mdash; you\'re often buying from people who are cashing out. Ask: <b>am I buying a good company, or am I afraid of missing out?</b>'
    };
  }
  if (y === 3) {
    var rumSh = 200 / p(3, 1, 'PPK');
    return {
      name: 'PetroPeak &middot; the false rumor',
      what: 'You bought PetroPeak because of an unconfirmed rumor about a giant oil field. The rumor was false.',
      cost: 'Your $200 rumor buy fell to ' + money2(rumSh * p(3, 2, 'PPK')) + ' when the truth came out, and it is still only ' + money2(rumSh * p(3, 3, 'PPK')) + ' (' + signed2(rumSh * p(3, 3, 'PPK') - 200) + '). ' +
        'A rumor moves the price <i>before</i> anyone knows if it\'s true. If it\'s false, the loss is yours to hold.',
      rule: '<b>A rumor isn\'t a fact &mdash; wait for confirmation.</b> "Sources say," "insiders hint," and "could be" mean nobody has confirmed it. In the real game, check the year-end screen to see which rumors were true.'
    };
  }
  var shpSh = 200 / p(4, 0, 'SHP'), holdV = shpSh * p(4, 3, 'SHP') + shpSh * 0.50;
  return {
    name: 'ShopRight &middot; your call',
    what: T.y5sold
      ? 'ShopRight\'s spring tax-refund bump tempted you, and you sold at $39.'
      : 'ShopRight\'s spring tax-refund bump tempted you to sell, but you recognized it as the season and held.',
    cost: T.y5sold
      ? 'You got ' + money2(T.y5sold) + ' for your shares. ShopRight then finished the year at $40 and paid a dividend you no longer owned. Holding would have left you with ' + money2(holdV) + ' &mdash; ' + money2(holdV - T.y5sold) + ' more. Small here, but in the real game that habit costs real money.'
      : 'Your $200 of ShopRight is worth ' + money2(shpSh * p(4, 3, 'SHP')) + ', plus a ' + money2(shpSh * 0.50) + ' dividend. That calm is exactly what the first four years taught you.',
    rule: '<b>Know the normal rhythm of what you own.</b> Stores have seasons. Energy swings. Banks pay dividends. Healthcare is steady. A move you could have predicted from the calendar isn\'t news.'
  };
}
var TUT_REFLECT = [
  'In your own words: why did selling MedCo on a scary headline cost you money?',
  'Why might a "boring" company that pays you be worth keeping?',
  'What would you check before buying a stock everyone is talking about?',
  'How can you tell a rumor from real news?',
  'What did you decide at ShopRight\'s spring bump, and why?'
];
function tutMoodPick(key, question) {
  var sel = (TP.moods || {})[key] || '';
  return '<div class="lr-feel" style="margin:10px 0 2px"><h4>' + question + '</h4><div class="lr-emotions">' +
    EMOTIONS.map(function (e) { return '<button class="lr-emotion' + (sel === e ? ' lr-emotion-on' : '') + '" onclick="tutMood(\'' + key + '\',\'' + e + '\')">' + e + '</button>'; }).join('') +
    '</div></div>';
}
function tutMood(key, e) { TP.moods = TP.moods || {}; TP.moods[key] = e; tutSave(TP); render(); }
function tutRecapReady(y) { var r = (TP.recaps || {})[y] || {}; return !!(TP.moods || {})['y' + y] && wordCount(r.text) >= REFLECT_MIN; }
function tutReflectInput(el, y) {             // no re-render while typing
  TP.recaps = TP.recaps || {}; TP.recaps[y] = { text: el.value }; tutSave(TP);
  var c = document.getElementById('lr-reflect-count'); if (c) c.innerHTML = reflectCount(el.value);
  var b = document.getElementById('lr-tut-gate'); if (b) b.outerHTML = tutRecapGate(y);
}
function tutRecapGate(y) {
  var ok = tutRecapReady(y);
  return '<button id="lr-tut-gate" class="lr-advance"' + (ok ? '' : ' disabled') + ' onclick="tutNext()">' +
    (ok ? (y < 4 ? 'On to Practice Year ' + (y + 2) + ' &rarr;' : 'Finish the practice round &rarr;') : '&uarr; Tap how it felt and write a sentence or two') + '</button>';
}
function tutRecap(step) {
  var y = step.y, T = tutState(TP.i, TP.choice), R = tutRecapContent(y, T);
  var txt = ((TP.recaps || {})[y] || {}).text || '';
  return tutChrome(y, T, { q: 3, text: 'Year recap' }) +
    '<div class="lr-card">' +
    '<div class="lr-year">Practice Year ' + (y + 1) + ' recap</div><h2>' + R.name + '</h2>' +
    '<div class="lr-recap"><h4>What happened</h4><p>' + R.what + '</p></div>' +
    '<div class="lr-recap"><h4>' + (y === 1 || (y === 4 && !T.y5sold) ? 'What it paid you' : 'What it cost you') + '</h4><p>' + R.cost + '</p></div>' +
    '<div class="lr-recap lr-recap-rule"><h4>Watch for this in the real game</h4><p>' + R.rule + '</p></div>' +
    tutMoodPick('y' + y, 'How did Practice Year ' + (y + 1) + ' feel?') +
    '<div class="lr-reflect"><h4>Reflect \u2014 write it here</h4><p class="lr-prompt">' + esc(TUT_REFLECT[y]) + '</p>' +
      '<textarea class="lr-reflect-box" rows="3" maxlength="600" placeholder="A sentence or two..." oninput="tutReflectInput(this,' + y + ')">' + esc(txt) + '</textarea>' +
      '<div class="lr-reflect-count" id="lr-reflect-count">' + reflectCount(txt) + '</div></div>' +
    tutRecapGate(y) +
    '</div>';
}
function tutRender() {
  var step = TUT_STEPS[TP.i] || TUT_STEPS[0];
  var skip = G.isTeacher ? '<div class="lr-previewbar">Teacher: you can skip the practice round <button onclick="tutSkip()">Skip practice &rarr;</button></div>' : '';
  if (step.k === 'welcome') {
    return skip + '<div class="lr-card"><div class="lr-year">Welcome</div><h2>The Long Run</h2>' +
      '<p>You\'ll invest a paycheck for <b>25 years</b> and see what your choices add up to. Your game saves every time you press an <b>Advance</b> button, so you can stop and pick up where you left off next time.</p>' +
      '<p>First, a <b>practice round</b>: five quick years with a $100 paycheck each quarter. The coach tells you exactly what to tap &mdash; including some classic mistakes, on purpose &mdash; then shows you what each one cost and what to watch for.</p>' +
      '<p class="lr-muted">Whatever you build in practice, you keep. It\'s your starting portfolio when the market goes live in Year 6.</p>' +
      '<button class="lr-advance" onclick="tutNext()">Start the practice round &rarr;</button></div>';
  }
  if (step.k === 'intro') {
    var I = TUT_INTRO[step.y], T0 = tutState(TP.i, TP.choice);
    return skip + tutChrome(step.y, T0, { q: 0, text: 'Learning the ropes' }) +
      '<div class="lr-card"><div class="lr-year">Practice Year ' + (step.y + 1) + ' of 5</div><h2>' + I.title + '</h2>' + I.body +
      '<button class="lr-advance" onclick="tutNext()">Start Practice Year ' + (step.y + 1) + ' &rarr;</button></div>';
  }
  if (step.k === 'q' || step.k === 'after') return skip + tutQuarter(step);
  if (step.k === 'recap') return skip + tutRecap(step);
  // final
  var T = tutState(TP.i, TP.choice), endV = tutValue(T, 4, 3);
  return '<div class="lr-card"><div class="lr-year">Practice round complete</div><h2>You\'re ready</h2>' +
    '<table class="lr-final"><tr><td>You put in</td><td>' + money(T.put) + '</td></tr>' +
    '<tr><td><strong>Your practice portfolio ended at</strong></td><td><strong>' + money2(endV) + '</strong></td></tr></table>' +
    '<div class="lr-recap lr-recap-rule"><h4>Five things to carry into the real game</h4><ol class="lr-tut-list">' +
      '<li><b>Did the business change, or just the headline?</b> (MedCo)</li>' +
      '<li><b>Steady income is worth keeping &mdash; boring can be good.</b> (TrustBank)</li>' +
      '<li><b>Already spiked + everyone excited = you\'re probably late.</b> (NovaTech)</li>' +
      '<li><b>A rumor isn\'t a fact. Wait for confirmation.</b> (PetroPeak)</li>' +
      '<li><b>Know the normal rhythm; don\'t flinch at the expected.</b> (ShopRight)</li></ol></div>' +
    '<div class="lr-recap"><h4>What changes in the real game</h4><ul class="lr-tut-list">' +
      '<li>Your paycheck becomes <b>$1,000 a quarter</b>, for <b>20 more years</b>.</li>' +
      '<li>Every company is unlocked, and you can also buy <b>Index 5</b> (a slice of all five companies) or <b>GrowthFund</b>.</li>' +
      '<li>Nobody tells you what to tap. Each year starts with forecasts, and rumors pop up when you least expect them. Every one is a test of the five rules above.</li></ul></div>' +
    '<p class="lr-muted">You keep it: your savings and every share you own come with you into Year 6, where the market goes live and your paycheck becomes $1,000 a quarter.</p>' +
    '<button class="lr-advance" onclick="tutFinish()">On to Year 6: the live market &rarr;</button></div>';
}

// One-time "how the real game works" panel on the real Year 1 opening screen.
function realGameGuide() {
  return '<div class="lr-recap lr-guide"><h4>How the live market works</h4><ul class="lr-tut-list">' +
    '<li>Every quarter, a <b>$1,000 paycheck</b> lands in savings (HYS). Savings earns interest; the rate is shown each year.</li>' +
    '<li>Buy with the <b>+</b> buttons: <b>Index 5</b> (all five companies, pays dividends), <b>GrowthFund</b> (a blend, no dividends), or single companies. Sell any time.</li>' +
    '<li>Each year opens with <b>forecasts</b> for every company. They\'re usually right about the direction and often wrong about how far.</li>' +
    '<li><b>Rumors</b> pop up at random during the year. Most are false; you\'ll learn the truth the next quarter.</li>' +
    '<li>At each year\'s end, tap how the year felt and write a sentence or two. Press <b>\uD83D\uDDA8 Report</b> any time to print your progress for your packet.</li>' +
    '<li>Your game saves each time you press an <b>Advance</b> button. If you leave mid-quarter, you redo that quarter.</li></ul></div>';
}

// ─── Init ──────────────────────────────────────────────────────────────────────
function init() { applyBoot(Server.boot()); render(); }
if (typeof document !== 'undefined') { init(); }
