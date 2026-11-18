// Bots that play the full 15-year game through the real UI.
'use strict';

function card(g, name) {
  return Array.from(g.doc.querySelectorAll('.lr-instr')).find(c => c.querySelector('.lr-instr-name').textContent.includes(name));
}
function cardBtn(g, name, re) {
  const c = card(g, name); if (!c) return null;
  return Array.from(c.querySelectorAll('button')).find(b => re.test(b.textContent.trim()));
}
function moneyNum(s) { return Number(String(s).replace(/[^0-9.\-−]/g, '').replace('−', '-')); }

// strategy(g, ctx) is called once per quarter screen, before advancing.
async function playYear(g, strategy, log, checks) {
  const G = g.G();
  if (G.phase === 'choose') await g.click(/^Begin Quarter 1/);
  for (let q = 0; q < 4; q++) {
    const ph = g.G().phase;
    if (!/^q[0-3]$/.test(ph)) throw new Error('expected quarter, got ' + ph);
    if (checks) checks.quarter(g);
    if (strategy) await strategy(g, { year: g.G().year, q });
    await g.click(/^(Advance to Q|Close out the year)/);
  }
  if (g.G().phase !== 'verify') throw new Error('expected verify, got ' + g.G().phase);
  if (checks) checks.verify(g);
  await g.click(/^Calm$/);
  const r = g.btn(/I've written my reflection|Reflection written/);
  if (r && !/written$/.test(r.textContent.trim()) ) { r.click(); await g.settle(); }
  await g.click(/^(On to Year|See your final results)/);
}

async function playGame(g, strategy, checks) {
  for (let y = 0; y < 15; y++) await playYear(g, strategy, null, checks);
  if (g.G().phase !== 'done') throw new Error('not done: ' + g.G().phase);
  const rows = Array.from(g.doc.querySelectorAll('.lr-final tr')).map(tr => [tr.cells[0].textContent.trim(), moneyNum(tr.cells[1].textContent)]);
  return Object.fromEntries(rows);
}

module.exports = { playGame, playYear, card, cardBtn, moneyNum };
