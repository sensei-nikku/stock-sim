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
 */

// ─── small engine helpers ────────────────────────────────────────────────────
function divCut(t, yr) {                       // banks slash in the collapse; retail trims
  if (yr === 6) return t === 'TBK' ? 0.50 : 0.75;
  if (yr === 7 || yr === 8) return t === 'TBK' ? 0.40 : 0.70;
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
    emotions: [], reflected: [],
    reveal: null, isTeacher: false, preview: false
  };
}
function serialize() {
  var skip = { reveal: 1, isTeacher: 1, preview: 1 };
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
  if (boot) {
    G.year = boot.year; G.phase = boot.phase; G.choice = boot.choice || G.choice;
    G.unlockedThrough = boot.unlockedThrough; G.reveal = boot.reveal || null;
    G.isTeacher = !!boot.isTeacher;
  }
  G.preview = false;
}

// ─── Server loop ───────────────────────────────────────────────────────────────
async function step(choice) {
  var res;
  try { res = await Server.advance(G.year, G.phase, serialize(), choice); }
  catch (e) { showError(String(e)); return 'error'; }
  if (res && res.ok === false) {
    if (res.stale) { applyBoot(res.boot); render(); return 'stale'; }
    showError(res.error || 'Something went wrong.'); return 'error';
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
  if (advancing) return;
  advancing = true;
  var snap = serialize();
  var i = G.hys * (FED_RATES[G.year] / 100 / 4);
  G.hys += i; G.yr.interest += i;
  try {
    var r = await step();
    if (r === 'error') { Object.assign(G, JSON.parse(snap)); render(); }  // undo so a retry doesn't double-credit (stale already replaced G)
  } finally { advancing = false; }
}

// ─── Render router ─────────────────────────────────────────────────────────────
// ─── Persistent top chrome: header bar + 15-year progress + phase label ────────
function headerValue() {
  if (G.phase !== 'choose' && G.reveal && G.reveal.prices) {
    try { return valueOf(G, curPrices(), curIndex()); } catch (e) {}
  }
  if (G.phase === 'choose' && G.year > 0) {
    try { return valueOf(G, soyPrices(), soyIndex()); } catch (e) {}
  }
  return valueOf(G, null, 100);
}
function chromeTop() {
  var y = (G.reveal && G.reveal.yearNumber) || (G.year + 1);
  if (G.phase === 'done') y = 15;
  var done = G.year || 0;                              // years fully committed
  var nowSeg = (G.phase === 'done') ? 0 : done + 1;    // year currently in play
  var segs = '';
  for (var i = 1; i <= 15; i++) {
    var cls = i <= done ? 'done' : (i === nowSeg ? 'now' : 'future');
    segs += '<span class="lr-seg lr-seg-' + cls + '"></span>';
  }
  var label = { choose: 'Start of Year', q0: 'Quarters', q1: 'Quarters', q2: 'Quarters',
                q3: 'Quarters', verify: 'Verify Your Tracker', done: 'Final Results' }[G.phase] || '';
  var name = G.playerName ? '<span class="lr-name">' + esc(G.playerName) + '</span>' : '';
  return '<div class="lr-chrome">' +
    '<div class="lr-topbar">' +
      '<div class="lr-actions">' + name +
        '<button class="lr-chip" onclick="headerSave(this)">\uD83D\uDCBE Save</button>' +
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
  var t = btn.innerHTML; btn.innerHTML = '\u2713 Saved'; btn.disabled = true;
  setTimeout(function () { btn.innerHTML = t; btn.disabled = false; }, 1500);
}
function headerReset() {
  // Student-side reset removed: students can no longer reset their own game.
  // Resets are teacher-only via the dashboard (resetStudent / resetMyGame).
}

// ─── Render router ─────────────────────────────────────────────────────────────
function render() {
  var app = document.getElementById('app');
  if (!G) { app.innerHTML = signInNotice(); return; }
  if (G.isTeacher && !G.preview) { app.innerHTML = renderTeacherPanel(); loadDashboard(); return; }
  var KNOWN = { choose: 1, q0: 1, q1: 1, q2: 1, q3: 1, verify: 1, done: 1 };
  var html = (KNOWN[G.phase] ? chromeTop() : '') + phaseHtml();
  if (KNOWN[G.phase]) { html += newsFab() + newsModal(); }
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
  var y = G.reveal.yearNumber, fed = FED_RATES[y - 1];
  var fedNote = fed <= 1 ? ' — cash earns almost nothing.' : fed >= 4 ? ' — savers are being paid well.' : '.';
  var first = (G.year === 0);
  var intro = first
    ? 'This is where the market opens. Your first <strong>' + money(PAYCHECK_Q) + '</strong> paycheck arrives in Quarter 1 — nothing to deploy yet, but read the news and get your bearings.'
    : 'These are <strong>last year\'s closing prices</strong>. Sell holdings or put savings to work now, before this year\'s first quarter — or just move on and decide quarter by quarter.';
  var p = soyPrices(), idx = soyIndex();
  var rows = INSTRUMENTS.map(function (inst) { return soyRow(inst, p, idx); }).join('');
  return '<div class="lr-card">' +
    '<div class="lr-year">Start of Year ' + y + '</div>' +
    '<h2>' + (first ? 'A new year begins' : 'Before the market opens') + '</h2>' +
    '<p class="lr-muted">' + intro + '</p>' +
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
  var n = Object.keys(r.news).filter(function (k) { return r.news[k]; }).length;
  return n + ((r.rumors || []).length);
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
      '<div class="lr-modal-tag" style="color:var(--blue)">Year ' + r.yearNumber + ' \u00B7 the news</div>' +
      '<h3>What\'s moving the market</h3>' +
      newsBlock(r.news) + rumorBlock(r.rumors) +
    '</div></div>';
}
function renderQuarter() {
  var r = G.reveal, q = qIndex(), p = curPrices(), idx = curIndex(), y = r.yearNumber, fed = FED_RATES[y - 1];
  var cards = INSTRUMENTS.map(function (inst) { return instrumentCard(inst, p, idx, y); }).join('');
  return '<div class="lr-card">' +
    '<div class="lr-year">Year ' + y + ' · Quarter ' + (q + 1) + '</div>' +
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
  var startV = G.valueHistory.length ? G.valueHistory[G.valueHistory.length - 1] : 0;
  var contrib = PAYCHECK_Q * 4, I = G.yr.interest, D = G.yr.divs;
  var market = preTax - startV - contrib - I - D;
  var endV = preTax - bill.total;
  var saved = saverProjection(r.yearNumber), aheadBy = endV - saved;
  var cmp = '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:11px 14px;margin:8px 0 2px;font-size:14px">' +
    '<span>If you had <strong>just saved</strong> every paycheck, you\'d have <strong>' + money(saved) + '</strong></span>' +
    '<span class="' + (aheadBy >= 0 ? 'lr-true' : 'lr-false') + '" style="font-family:var(--mono);font-weight:700">' + (aheadBy >= 0 ? '\u25B2 ahead by ' : '\u25BC behind by ') + money(Math.abs(aheadBy)) + '</span></div>';
  var truthRows = (r.truths || []).map(function (tr) {
    return '<tr><td>' + esc(tr.text) + '</td><td class="' + (tr.factTrue ? 'lr-true' : 'lr-false') + '">' + (tr.factTrue ? 'TRUE' : 'FALSE') + '</td></tr>';
  }).join('');
  return '<div class="lr-card">' +
    '<div class="lr-year">Year ' + r.yearNumber + ' — ' + esc(r.title) + '</div>' +
    '<div class="lr-gl"><table>' +
      row('Started the year with', money(startV)) +
      row('Your paychecks added', '+' + money(contrib)) +
      row('Interest earned', '+' + money(I)) +
      row('Dividends collected', '+' + money(D)) +
      row('What the market did', (market >= 0 ? '+' : '−') + money(Math.abs(market)), market >= 0 ? 'lr-true' : 'lr-false') +
      row('Taxes settled', '−' + money(bill.total), 'lr-false') +
      '<tr class="lr-gl-end"><td>Ended with</td><td>' + money(endV) + '</td></tr>' +
    '</table></div>' +
    cmp +
    eoyTickerTable(r) +
    eoyGallery(r) +
    taxBillBlock(bill) +
    '<div class="lr-truths"><h4>What the tabloids got right (and wrong)</h4><table>' + truthRows + '</table></div>' +
    hindsightBlock(r) +
    emotionBlock() +
    reflectBlock(r) +
    advanceGate(r) +
    '</div>';
}
function advanceGate(r) {
  var hasE = !!G.emotions[G.year], hasR = !!G.reflected[G.year];
  if (hasE && hasR) return '<button class="lr-advance" onclick="commitVerify()">' + (G.year >= 14 ? 'See your final results →' : 'On to Year ' + (r.yearNumber + 1) + ' →') + '</button>';
  var msg = !hasE ? '↑ Mark how this year felt to continue' : '↑ Jot your reflection, then confirm below';
  return '<button class="lr-advance" disabled style="opacity:.45;cursor:not-allowed;">' + msg + '</button>';
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
  return '<div class="lr-gallery"><h4>Price history through Year ' + r.yearNumber + '</h4>' +
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
  var out = [], idxRet = r.index[3] / r.index[0] - 1;
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
// A short, behavior-anchored prompt the student answers IN THEIR JOURNAL (on paper).
function reflectBlock(r) {
  var done = G.reflected[G.year];
  return '<div class="lr-reflect"><h4>Reflect — in your journal</h4>' +
    '<p class="lr-prompt">' + esc(journalPrompt(r)) + '</p>' +
    '<button class="lr-confirm' + (done ? ' lr-confirm-on' : '') + '" onclick="toggleReflected()">' +
      (done ? '✓ Reflection written' : 'I\'ve written my reflection') + '</button></div>';
}
function journalPrompt(r) {
  var idxRet = r.index[3] / r.index[0] - 1;
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
  applyYearEnd(G, G.reveal, G.year + 1);
  try {
    var r = await step();
    if (r === 'error') { Object.assign(G, JSON.parse(snap)); render(); }  // undo so a retry re-runs year-end cleanly
  } finally { advancing = false; }
}

// ─── Game over ─────────────────────────────────────────────────────────────────
function renderDone() {
  var v = G.valueHistory.length ? G.valueHistory[G.valueHistory.length - 1] : 0;
  var saver = G.saverHistory.length ? G.saverHistory[G.saverHistory.length - 1] : 0;
  var dca = G.dcaHistory.length ? G.dcaHistory[G.dcaHistory.length - 1] : 0;
  var contributed = PAYCHECK_Q * 4 * 15;
  var feelTl = G.emotions.map(function (e, i) { return e ? '<span class="lr-feelchip">Y' + (i + 1) + ': ' + e + '</span>' : ''; }).join('');
  var INFLATION = 0.03, inflTarget = 0, annual = PAYCHECK_Q * 4;
  for (var iy = 1; iy <= 15; iy++) inflTarget += annual * Math.pow(1 + INFLATION, 15 - iy);
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
    '<div class="lr-year">15 years later</div>' +
    '<h2>You ended with ' + money(v) + '</h2>' +
    '<p class="lr-muted">You contributed ' + money(contributed) + ' of your own money over 15 years.</p>' +
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
    '</div>';
}

// ─── News + rumors ───────────────────────────────────────────────────────────
function newsBlock(news) {
  if (!news) return '';
  var items = TICKERS.filter(function (t) { return news[t]; }).map(function (t) {
    return '<div class="lr-news" onclick="showArticle(\'' + t + '\')"><b style="color:' + STOCKS[t].color + '">' + t + '</b> ' + esc(news[t].headline) + '</div>';
  }).join('');
  return items ? '<div class="lr-newswire"><h4>The wire</h4>' + items + '</div>' : '';
}
function showArticle(t) {
  var n = G.reveal.news[t]; if (!n) return;
  var m = document.createElement('div'); m.className = 'lr-modal-backdrop';
  m.innerHTML = '<div class="lr-modal"><button class="lr-modal-x" aria-label="Close">&times;</button>' +
    '<div class="lr-modal-tag" style="color:' + STOCKS[t].color + '">' + t + ' · ' + STOCKS[t].name + '</div>' +
    '<h3>' + esc(n.headline) + '</h3><p>' + esc(n.article) + '</p></div>';
  m.addEventListener('click', function (e) { if (e.target === m || e.target.className === 'lr-modal-x') m.remove(); });
  document.body.appendChild(m);
}
function rumorBlock(rumors) {
  if (!rumors || !rumors.length) return '';
  var cards = rumors.map(function (r) {
    return '<div class="lr-rumor"><div class="lr-rumor-head">EXCLUSIVE</div><div class="lr-rumor-text">' + esc(r.text) + '</div><div class="lr-rumor-src">— ' + esc(r.source) + ' · UNVERIFIED</div></div>';
  }).join('');
  return '<div class="lr-tabloid"><h4>The Street Tattler</h4>' + cards + '</div>';
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
function dashboardTable(students) {
  if (!students || !students.length) return '<p class="lr-muted">No students have started yet.</p>';
  var rows = students.map(function (s) {
    var v = '—', feels = '';
    try {
      var st = JSON.parse(s.state || '{}');
      if (st.valueHistory && st.valueHistory.length) v = money(st.valueHistory[st.valueHistory.length - 1]);
      if (st.emotions && st.emotions.length) feels = st.emotions.map(function (e) { return e ? e.slice(0, 3) : '·'; }).join(' ');
    } catch (e) {}
    return '<tr><td>' + esc(s.email) + '</td><td>Year ' + (Number(s.year) + 1) + '</td><td>' + esc(s.phase) +
      '</td><td>' + v + '</td><td class="lr-feeltrail">' + esc(feels) + '</td><td>' + fmtDate(s.updatedAt) +
      '</td><td><button onclick="resetStudent(\'' + esc(s.email) + '\')">Reset</button></td></tr>';
  }).join('');
  return '<table class="lr-dash"><thead><tr><th>Student</th><th>Progress</th><th>Phase</th><th>Latest value</th><th>Feelings</th><th>Updated</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
}
async function resetStudent(email) {
  if (!confirm('Reset ' + email + ' back to Year 1? This erases their progress.')) return;
  try { var res = await Server.resetStudent(email); if (res && res.ok) loadDashboard(); else showError((res && res.error) || 'Reset failed.'); }
  catch (e) { showError(String(e)); }
}
function fmtDate(d) { try { var x = new Date(d); return isNaN(x) ? '—' : x.toLocaleDateString(); } catch (e) { return '—'; } }
function previewAsStudent() { G.preview = true; render(); }
function exitPreview() { G.preview = false; render(); }
async function resetMyGame() {
  if (!confirm('Reset YOUR own game back to Year 1? (Students are not affected.)')) return;
  try { var res = await Server.resetMe(); if (res && res.ok) { applyBoot(res.boot); render(); } else showError((res && res.error) || 'Reset failed.'); }
  catch (e) { showError(String(e)); }
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

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function showError(msg) { var a = document.getElementById('app'); if (a) a.insertAdjacentHTML('afterbegin', '<div class="lr-error">' + esc(msg) + '</div>'); }

// ─── Init ──────────────────────────────────────────────────────────────────────
function init() { applyBoot(Server.boot()); render(); }
if (typeof document !== 'undefined') { init(); }
