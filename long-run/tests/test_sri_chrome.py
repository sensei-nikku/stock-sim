"""Real Chrome: does Subresource Integrity actually block tampered files, and does the shell fall back?
Serves the shell from a fake googleusercontent origin; GitHub Pages and jsDelivr requests are
answered from the local release folder (with Access-Control-Allow-Origin: *, like the real hosts)."""
import os, re, subprocess, sys
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
REL = sys.argv[1] if len(sys.argv) > 1 else '2026-11-19-v2'
html = subprocess.check_output(['node', os.path.join(HERE, 'gen_page.js'), REL], env=dict(os.environ, NODE_PATH='/home/claude/harness/node_modules'), text=True)
STUB = "window.google={script:{run:new Proxy({},{get:()=>()=>({})}),url:{getLocation:function(cb){setTimeout(function(){cb({parameter:{}})},1)}}}};"
PAT = re.compile(r'^https://(sensei-nikku\.github\.io/stock-sim|cdn\.jsdelivr\.net/gh/sensei-nikku/stock-sim@[\w.-]+)/long-run/(releases/[\w.-]+|beta)/([\w.]+)')
results = []
def ok(c, m): results.append(c); print(('  ok   ' if c else '  FAIL ') + m)

def run(tamper):   # tamper: set of (host, file) to corrupt
    hits = []
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
        pg = b.new_page(); pg.add_init_script(STUB)
        msgs = []; pg.on('console', lambda m: msgs.append(m.text))
        def handle(route):
            u = route.request.url
            if u.startswith('https://n-test.script.googleusercontent.com/'):
                return route.fulfill(status=200, body=html, headers={'content-type': 'text/html'})
            m = PAT.match(u)
            if m:
                host = 'pages' if 'github.io' in m.group(1) else 'cdn'
                body = open(os.path.join(ROOT, m.group(2), m.group(3)), 'rb').read()
                if (host, m.group(3)) in tamper: body += b'\n/* tampered */\n'
                hits.append(host + ':' + m.group(3))
                ctype = 'text/css' if m.group(3).endswith('.css') else 'application/javascript'
                return route.fulfill(status=200, body=body, headers={'content-type': ctype, 'access-control-allow-origin': '*'})
            hits.append('OTHER:' + u)
            return route.fulfill(status=404, body='')
        pg.route('**/*', handle)
        pg.goto('https://n-test.script.googleusercontent.com/userCodeAppPanel')
        pg.wait_for_function("document.querySelector('#app .lr-card') || document.querySelector('.lr-bootfail')", timeout=15000)
        text = pg.inner_text('#app'); b.close()
    return text, hits, msgs

t, h, m = run(set())
ok('practice round' in t.lower() and all(x.startswith('pages:') for x in h), 'untouched files: game loads from GitHub Pages only, nothing else requested (' + ', '.join(h) + ')')
t, h, m = run({('pages', 'game.js')})
ok('practice round' in t.lower() and 'cdn:game.js' in h and any('integrity' in x.lower() for x in m), 'tampered game.js on Pages: Chrome blocks it (integrity error), shell falls back to jsDelivr, game loads')
t, h, m = run({('pages', 'styles.css')})
ok('practice round' in t.lower() and 'cdn:styles.css' in h, 'tampered styles.css on Pages: blocked, jsDelivr used')
t, h, m = run({('pages', 'game.js'), ('cdn', 'game.js')})
ok("couldn't load" in t and 'practice round' not in t.lower(), 'tampered on BOTH hosts: nothing runs, student sees "The game couldn\'t load"')
t, h, m = run({('pages', 'data.js'), ('cdn', 'persistence.js')})
ok("couldn't load" in t, 'different files tampered on each host: still refuses to run')
print(f"\n{sum(results)} passed, {len(results) - sum(results)} failed")
sys.exit(0 if all(results) else 1)
