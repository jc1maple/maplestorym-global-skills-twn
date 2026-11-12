"""Idempotent page-shell edits that are not skill data.

- loads refinements.css / refinements.js (compact showcase, solid toolbar, Lv.200 sub-groups, readable meta)
- shows the client data version in the header
- a text search looks through every scope: common cores (鏡之蜘蛛, 太陽之冠...) used to be hidden by the
  default scope filter even when searched by name
- shorter search placeholder so it is not clipped on phones

    python scripts/update-shell.py          # rewrite index.html
    python scripts/update-shell.py --check  # exit 1 if index.html is not up to date
"""
import argparse
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSET_VERSION = '20261112d'
DATA_VERSION = ('2.460', 'Global/TWN 用戶端 2.460.5829，2026-11-12')


def update(text):
    css = f'<link rel="stylesheet" href="refinements.css?v={ASSET_VERSION}">'
    text = re.sub(r'\n  <link rel="stylesheet" href="refinements\.css\?v=[^"]*">', '', text)
    anchor = re.search(r'  <link rel="stylesheet" href="skill-configurator\.css\?v=[^"]*">', text)
    text = text[:anchor.end()] + '\n  ' + css + text[anchor.end():]

    # Theme is decided before first paint (saved choice, else the system setting) so dark pages never flash white.
    boot = "<script>try{document.documentElement.dataset.theme=localStorage.getItem('skill-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light')}catch(e){}</script>"
    if boot not in text:
        text = text.replace(css, css + chr(10) + '  ' + boot, 1)

    js = f'<script src="refinements.js?v={ASSET_VERSION}" defer></script>'
    text = re.sub(r'\n  <script src="refinements\.js\?v=[^"]*" defer></script>', '', text)
    anchor = re.search(r'  <script src="modern-ui\.js\?v=[^"]*" defer></script>', text)
    text = text[:anchor.end()] + '\n  ' + js + text[anchor.end():]

    badge = f'<span class="data-version" title="{DATA_VERSION[1]}"><strong>{DATA_VERSION[0]}</strong> 資料版本</span>'
    text = re.sub(r'\n          <span class="data-version"[^>]*>.*?</span>', '', text)
    anchor = re.search(r'          <span><strong>\d+</strong> 個職業</span>', text)
    text = text[:anchor.end()] + '\n          ' + badge + text[anchor.end():]

    old_scope = 'const scopeMatch = !scopes || scopes.has(card.dataset.scope);'
    new_scope = 'const scopeMatch = !scopes || scopes.has(card.dataset.scope) || Boolean(term); // a text search spans every scope'
    if new_scope not in text:
        assert text.count(old_scope) == 1
        text = text.replace(old_scope, new_scope)

    text = text.replace('placeholder="搜尋技能、核心代碼或描述…"', 'placeholder="搜尋技能或描述…"')

    # Decorative English labels are dropped or written in Chinese; cache-bust the scripts touched for it.
    text = re.sub(r' *<span>FILTERS</span>\r?\n', '', text)
    text = text.replace('<span class="brand-kicker">MAPLESTORY M · GLOBAL / TWN</span>', '<span class="brand-kicker">楓之谷 M · 國際版繁中</span>')
    text = re.sub(r'skill-configurator\.js\?v=[^"]*', f'skill-configurator.js?v={ASSET_VERSION}', text)
    return text


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    path = ROOT / 'index.html'
    before = path.read_text(encoding='utf8')
    after = update(before)
    assert update(after) == after, 'not idempotent'
    if args.check:
        if after != before:
            print('index.html shell is not up to date')
            sys.exit(1)
        print('OK: shell up to date')
        return
    if after != before:
        path.write_text(after, encoding='utf8', newline='\n')
    print('shell updated' if after != before else 'no change')


if __name__ == '__main__':
    main()
