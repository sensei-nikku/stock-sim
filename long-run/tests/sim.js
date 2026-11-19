// Harness for The Long Run: real Code.gs + Market.gs in a Node VM with stubbed
// Google services, and the real Apps Script shell + GitHub client files in jsdom.
// The shell's GitHub URLs are served from the local repo checkout.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM, ResourceLoader, VirtualConsole } = require('jsdom');

const SRC = process.env.LR_SRC || '/home/claude/longrun-src';   // Code.gs + Market.gs live here, NOT in the repo
const REPO = process.env.LR_REPO || path.join(__dirname, '..');

// ---------------------------------------------------------------- server ----
function makeServer() {
  const sheets = {};
  let email = '';
  function makeSheet(name) {
    const rows = [];
    const sh = {
      name, rows,
      appendRow(r) { rows.push(r.slice()); },
      getLastRow() { return rows.length; },
      getRange(r, c, nr, nc) {
        nr = nr || 1; nc = nc || 1;
        return {
          getValues() {
            const out = [];
            for (let i = 0; i < nr; i++) {
              const row = rows[r - 1 + i] || [];
              const o = [];
              for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]);
              out.push(o);
            }
            return out;
          },
          getValue() { return this.getValues()[0][0]; },
          setValues(v) {
            for (let i = 0; i < nr; i++) {
              rows[r - 1 + i] = rows[r - 1 + i] || [];
              for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = v[i][j];
            }
          },
          setValue(v) { this.setValues([[v]]); }
        };
      },
      getParent() { return ss; },
      setFrozenRows() {}
    };
    return sh;
  }
  const ss = {
    getSheetByName(n) { return sheets[n] || null; },
    insertSheet(n) { sheets[n] = makeSheet(n); return sheets[n]; },
    getSpreadsheetTimeZone() { return 'America/Phoenix'; }
  };
  const props = {}, errorsLogged = [];
  const ctx = {
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    JSON, Math, Date, String, Number, Object, Array,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    Session: { getActiveUser: () => ({ getEmail: () => email }), getScriptTimeZone: () => 'America/Phoenix' },
    LockService: { getUserLock: () => ({ waitLock() {}, releaseLock() {} }), getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: { formatDate: (d) => new Date(d).toISOString() },
    HtmlService: {
      XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', DEFAULT: 'DEFAULT' },
      createTemplateFromFile(name) {
        const t = {
          evaluate() {
            let html = fs.readFileSync(t.__file, 'utf8');
            html = html.replace(/<\?!=\s*BOOT\s*\?>/g, t.BOOT);
            html = html.replace(/<\?!=\s*longRunRelease\(\)\s*\?>/g, () => ctx.longRunRelease());
            html = html.replace(/<\?!=\s*include\('(\w+)'\);?\s*\?>/g, (m, f) => fs.readFileSync(path.join(SRC, f + '.html'), 'utf8'));
            const out = { getContent: () => html, setTitle() { return out; }, addMetaTag() { return out; }, setXFrameOptionsMode(m) { out.xframe = m; return out; } };
            return out;
          }
        };
        t.__file = name === 'Index' ? path.join(REPO, 'apps-script/Index.html') : name;   // renderIndex() may point elsewhere
        return t;
      },
      createHtmlOutputFromFile(f) { return { getContent: () => fs.readFileSync(path.join(SRC, f + '.html'), 'utf8') }; }
    },
    console: { log() {}, error(...a) { errorsLogged.push(a.join(' ')); } },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(SRC, 'Market.gs'), 'utf8'), ctx, { filename: 'Market.gs' });
  vm.runInContext(fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  const relGs = path.join(REPO, 'apps-script/Release.gs');
  if (fs.existsSync(relGs)) vm.runInContext(fs.readFileSync(relGs, 'utf8'), ctx, { filename: 'Release.gs' });
  return {
    ctx, sheets, props, errorsLogged,
    setEmail(e) { email = e; },
    // pin a frozen release folder the way a teacher would in Script Properties
    useRelease(id, opts) {
      if (id == null) { ctx.LIVE_RELEASE = undefined; return; }
      const crypto = require('crypto'), files = {};
      for (const f of ['styles.css', 'data.js', 'persistence.js', 'game.js']) {
        files[f] = 'sha384-' + crypto.createHash('sha384').update(fs.readFileSync(path.join(REPO, 'releases', id, f))).digest('base64');
      }
      ctx.LIVE_RELEASE = (opts && opts.raw) || { id, sha: 'a'.repeat(40), files };
    },
    renderIndex(indexFile) {
      const t = ctx.HtmlService.createTemplateFromFile('Index');
      t.__file = indexFile;
      // mirror doGet() without touching the stub plumbing
      const e = email;
      t.BOOT = e ? JSON.stringify(ctx.boot_(e)) : 'null';
      return t.evaluate().getContent();
    },
    call(name, args) { return ctx[name].apply(null, args); }
  };
}

// ---------------------------------------------------------------- client ----
class LocalLoader extends ResourceLoader {
  fetch(url, opts) {
    const m = url.match(/^https:\/\/(?:sensei-nikku\.github\.io\/stock-sim|cdn\.jsdelivr\.net\/gh\/sensei-nikku\/stock-sim@[\w.-]+)\/long-run\/(live|beta|releases\/[\w.-]+)\/([\w.]+)/);
    if (m) {
      if (this.blockPages && url.includes('github.io')) return Promise.reject(new Error('blocked'));
      const f = path.join(REPO, m[1], m[2]);
      if (!fs.existsSync(f)) return Promise.reject(new Error('404 ' + url));
      this.loaded.push(m[1] + '/' + m[2] + (url.includes('jsdelivr') ? ' (jsdelivr)' : ''));
      return Promise.resolve(fs.readFileSync(f));
    }
    (this.others = this.others || []).push(url);
    return Promise.resolve(Buffer.from(''));   // anything else (should be nothing)
  }
}

async function openGame(server, opts) {
  opts = opts || {};
  const html = server.renderIndex(opts.indexFile || path.join(REPO, 'apps-script/Index.html'));
  const loader = new LocalLoader();
  loader.loaded = [];
  loader.blockPages = !!opts.blockPages;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e && (e.stack || e.message || e))));
  vc.on('error', (e) => errors.push(String(e)));
  let pending = 0;
  const dom = new JSDOM(html, {
    url: 'https://n-abc.script.googleusercontent.com/userCodeAppPanel',
    runScripts: 'dangerously', resources: loader, pretendToBeVisual: true, virtualConsole: vc,
    beforeParse(window) {
      if (opts.seedStorage) { for (const k in opts.seedStorage) window.localStorage.setItem(k, opts.seedStorage[k]); }
      window.confirm = () => true;
      window.scrollTo = () => {};
      window.alert = () => {};
      function runner(ok, bad) {
        return new Proxy({}, {
          get(_, prop) {
            if (prop === 'withSuccessHandler') return (fn) => runner(fn, bad);
            if (prop === 'withFailureHandler') return (fn) => runner(ok, fn);
            if (prop === 'apply' || prop === 'call') return undefined;
            return function () {
              const args = JSON.parse(JSON.stringify(Array.prototype.slice.call(arguments)));
              pending++;
              setTimeout(() => {
                try {
                  if (opts.failNext && opts.failNext.length && opts.failNext[0] === prop) { opts.failNext.shift(); throw new Error('simulated network failure'); }
                  const r = server.call(prop, args);
                  pending--;
                  ok && ok(r === undefined ? null : JSON.parse(JSON.stringify(r)));
                } catch (e) { pending--; bad && bad(e); }
              }, 2);
            };
          }
        });
      }
      window.google = { script: {
        run: runner(null, null),
        url: { getLocation(cb) { setTimeout(() => cb({ parameter: opts.params || {}, hash: '' }), 1); } }
      } };
    }
  });
  const w = dom.window;
  const g = {
    dom, w, doc: w.document, errors, loader,
    pending: () => pending,
    async settle(ms) {
      await new Promise(r => setTimeout(r, ms || 15));
      for (let i = 0; i < 400 && pending > 0; i++) await new Promise(r => setTimeout(r, 5));
      await new Promise(r => setTimeout(r, 5));
    },
    G: () => w.eval('G'),
    text: () => w.document.getElementById('app').textContent,
    buttons: () => Array.from(w.document.querySelectorAll('#app button')),
    btn(re) { return g.buttons().find(b => re.test(b.textContent.trim())); },
    async click(re) {
      const b = g.btn(re);
      if (!b) throw new Error('no button ' + re + ' on screen: ' + g.text().slice(0, 300));
      if (b.disabled) throw new Error('button disabled ' + re);
      b.click();
      await g.settle();
      return b;
    }
  };
  // wait for the engine to boot
  for (let i = 0; i < 300; i++) {
    await new Promise(r => setTimeout(r, 10));
    if (w.document.querySelector('#app .lr-card') || w.document.querySelector('.lr-bootfail')) break;
  }
  return g;
}

module.exports = { makeServer, openGame, SRC, REPO };
