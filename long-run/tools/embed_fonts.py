"""Replace the Google Fonts @import in a styles.css with the same fonts inlined as data: URIs,
so they're covered by the file's SRI hash and nothing is fetched from fonts.googleapis.com.
Same families and weights the @import asked for. Fonts: SIL OFL 1.1 (long-run/fonts/OFL-*.txt),
woff2 latin subsets from Fontsource 5.3.0.

    python3 tools/embed_fonts.py beta/styles.css    # idempotent
"""
import base64, pathlib, sys
FONTS = pathlib.Path('/home/claude/fonts/node_modules/@fontsource')
FACES = [('DM Serif Display', 'dm-serif-display', [400]),
         ('IBM Plex Sans', 'ibm-plex-sans', [400, 500, 600, 700]),
         ('JetBrains Mono', 'jetbrains-mono', [400, 500, 600])]
IMPORT = "@import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=IBM+Plex+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap');"
MARK = '/* ── embedded fonts'

def faces():
    out = [MARK + ' (SIL OFL 1.1, see long-run/fonts/; inlined so the SRI hash covers them) ── */']
    for fam, pkg, weights in FACES:
        for w in weights:
            b = (FONTS / pkg / 'files' / f'{pkg}-latin-{w}-normal.woff2').read_bytes()
            out.append("@font-face{font-family:'%s';font-style:normal;font-weight:%d;font-display:swap;"
                       "src:url(data:font/woff2;base64,%s) format('woff2');}" % (fam, w, base64.b64encode(b).decode()))
    return '\n'.join(out) + '\n'

p = pathlib.Path(sys.argv[1]); css = p.read_text()
if MARK in css:
    print(p, 'already embedded'); sys.exit()
assert css.count(IMPORT) == 1, 'expected exactly one Google Fonts @import'
css = css.replace(IMPORT, '/* fonts: embedded at the end of this file (no external font requests) */')
p.write_text(css.rstrip('\n') + '\n\n' + faces())
print(p, 'embedded; now', len(css) // 1024, '->', p.stat().st_size // 1024, 'KB')
