// Play through v3 in jsdom and dump the shell HTML + browser storage at interesting moments,
// so shots_v3.py can screenshot the same states in real Chrome. Usage: node shots_v3.js <release> <outdir>
'use strict';
const fs = require('fs'), path = require('path');
const { makeServer, openGame } = require('./sim');
const REL = process.argv[2] || 'dev-v3', OUT = process.argv[3] || '/home/claude/shots/v3';
const server = makeServer(); server.useRelease(REL);
const C = server.ctx;
const IDX = path.join(__dirname, '../apps-script/Index.html');
let n = 0;
function cap(g, name, after) {
  const st = {}; for (let i = 0; i < g.w.localStorage.length; i++) { const k = g.w.localStorage.key(i); st[k] = g.w.localStorage.getItem(k); }
  const file = path.join(OUT, String(++n).padStart(2, '0') + '_' + name + '.json');
  fs.writeFileSync(file, JSON.stringify({ html: server.renderIndex(IDX), storage: st, after: after || '' }));
}
async function type(g, sel, s) { const ta = g.doc.querySelector(sel); ta.value = s; ta.dispatchEvent(new g.w.Event('input', { bubbles: true })); await g.settle(3); }
const has = (g, sel) => !!g.doc.querySelector(sel);

(async () => {
  // pick a student with a rumor in an early loud year, to show the modal
  let em = null;
  for (let i = 0; i < 400 && !em; i++) { const e = 'jordan' + i + '@excelcenteraz.org'; const y = C.buildYear_(e, 5); if (y.rumors.length >= 2 && C.buildYear_(e, 0).rumors.length) em = e; }
  server.setEmail(em);
  let g = await openGame(server);
  cap(g, 'welcome');
  await g.click(/^Start the practice round/);
  for (let y = 0; y < 5; y++) {
    await g.click(/^Start Practice Year/);
    for (let q = 0; q < 4; q++) {
      const pulse = g.doc.querySelector('.lr-instr button.lr-pulse:not([disabled])');
      if (pulse) {
        if (y === 4 && q === 1) await g.click(/^Hold$/); else { pulse.click(); await g.settle(3); }
        if (y === 0) cap(g, 'practice_after_move');
        await g.click(/^Anxious$/);
      }
      await g.click(/^(Next quarter|See how Practice Year)/);
    }
    await g.click(/^Calm$/);
    await type(g, '.lr-reflect-box', 'I panicked and sold when the headline hit, and it cost me the rebound. Next time I will check whether the business actually changed.');
    if (y === 0) cap(g, 'practice_recap');
    await g.click(/^(On to Practice Year|Finish the practice round)/);
  }
  cap(g, 'practice_final');
  await g.click(/^On to Year 6/);
  cap(g, 'year6_open');
  const answer = async () => { let k = 0; while (has(g, '.lr-modal-backdrop .lr-rumor') && k++ < 5) await g.click(/^Anxious$/); };
  let shotModal = false, shotUpdate = false, shotVerify = false;
  for (let y = 0; y < 20; y++) {
    if (y === 5) cap(g, 'year11_open');
    await g.click(/^Begin Quarter 1/);
    for (let q = 0; q < 4; q++) {
      if (!shotModal && has(g, '.lr-modal-backdrop .lr-rumor') && y >= 5) { cap(g, 'rumor_modal'); shotModal = true; }
      await answer();
      if (!shotUpdate && has(g, '.lr-rumorupdates') && y >= 5) { cap(g, 'rumor_update'); shotUpdate = true; }
      if (y === 6 && q === 1) { for (let k = 0; k < 3; k++) { const b = Array.from(g.doc.querySelectorAll('.lr-instr')).find(c => /Index 5/.test(c.textContent)); const bb = b && Array.from(b.querySelectorAll('button')).find(x => x.textContent.trim() === '+$1000'); if (bb && !bb.disabled) { bb.click(); await g.settle(2); } } }
      await g.click(/^(Advance to Q|Close out the year)/);
    }
    if (!shotVerify && y >= 5 && g.doc.querySelectorAll('.lr-truths tr').length > 3) { cap(g, 'verify'); shotVerify = true; }
    if (y === 12) cap(g, 'verify_year18');
    await g.click(/^Calm$/);
    await type(g, '.lr-reflect-box', 'Year ' + (y + 6) + ': the rumors were loud but I held my index and kept my paycheck going in.');
    await g.click(/^(On to Year|See your final results)/);
  }
  cap(g, 'done');
  cap(g, 'report', 'openReport()');
  server.setEmail(C.TEACHERS[0]);
  g = await openGame(server); await g.settle(30);
  cap(g, 'teacher_dash');
  console.log('captured', n, 'states for', em, 'errors:', g.errors.length);
})().catch(e => { console.error(e); process.exit(2); });
