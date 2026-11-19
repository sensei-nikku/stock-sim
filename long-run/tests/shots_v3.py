"""Screenshot the states dumped by shots_v3.js in real Chrome (files served from the local release)."""
import glob, json, os, re, sys
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE)
SRC = sys.argv[1] if len(sys.argv) > 1 else '/home/claude/shots/v3'
STUB = "window.google={script:{run:new Proxy({},{get:(t,p)=>p==='withSuccessHandler'||p==='withFailureHandler'?()=>window.google.script.run:()=>({})}),url:{getLocation:function(cb){setTimeout(function(){cb({parameter:{}})},1)}}}};"
PAT = re.compile(r'^https://(sensei-nikku\.github\.io/stock-sim|cdn\.jsdelivr\.net/gh/sensei-nikku/stock-sim@[\w.-]+)/long-run/(releases/[\w.-]+|beta)/([\w.]+)')
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    for f in sorted(glob.glob(os.path.join(SRC, '*.json'))):
        d = json.load(open(f)); name = os.path.splitext(f)[0]
        ctx = b.new_context(viewport={'width': 1366, 'height': 768})
        pg = ctx.new_page()
        pg.add_init_script(STUB + 'try{var S=' + json.dumps(d['storage']) + ';for(var k in S)localStorage.setItem(k,S[k]);}catch(e){}')
        errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
        html = d['html']
        def handle(route, request=None, html=html):
            u = route.request.url
            if u.startswith('https://n-test.script.googleusercontent.com/'):
                return route.fulfill(status=200, body=html, headers={'content-type': 'text/html; charset=utf-8'})
            m = PAT.match(u)
            if m:
                body = open(os.path.join(ROOT, m.group(2), m.group(3)), 'rb').read()
                ct = ('text/css' if m.group(3).endswith('.css') else 'application/javascript') + '; charset=utf-8'
                return route.fulfill(status=200, body=body, headers={'content-type': ct, 'access-control-allow-origin': '*'})
            return route.fulfill(status=404, body='')
        pg.route('**/*', handle)
        pg.goto('https://n-test.script.googleusercontent.com/userCodeAppPanel')
        pg.wait_for_function("document.querySelector('#app .lr-card') || document.querySelector('.lr-bootfail')", timeout=15000)
        if d['after']: pg.evaluate(d['after']); pg.wait_for_timeout(200)
        pg.wait_for_timeout(300)
        pg.screenshot(path=name + '.png', full_page=True)
        if 'report' in name:
            pg.emulate_media(media='print'); pg.pdf(path=name + '.pdf', format='Letter', print_background=True)
            pg.screenshot(path=name + '_print.png', full_page=True)
        print(os.path.basename(name), 'errors:', errs)
        ctx.close()
    b.close()
