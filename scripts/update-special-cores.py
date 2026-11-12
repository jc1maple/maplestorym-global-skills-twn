"""Idempotently replace the retired V special cores with the five 2.460 ones.

2.460 deleted every earlier special core and added five (VMatrix/VCoreSkill/VCoreSkill_Special
rows with JobSet.Num 1-5). Every job section that has V cards loses its old special cards and
gets the five current ones at the end of its Lv.200 grid.

    python scripts/update-special-cores.py          # rewrite index.html
    python scripts/update-special-cores.py --check  # exit 1 if index.html is not up to date
"""
import argparse
import html
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER_START = '<!-- special-cores:start -->'
MARKER_END = '<!-- special-cores:end -->'
GAP = '\n    \n\n      '
CARD_RE = r'<article class="skill-card\b[\s\S]*?</article>'
JOB_RE = r'(<section class="job-section" data-job="([^"]+)"[\s\S]*?)(?=<section class="job-section"|<!-- job-boris:end -->|<div id="skill-preview-popover")'
LV200_RE = r'(<section class="stage-section" data-stage-group="lv200">[\s\S]*?<div class="skill-grid">\n)([\s\S]*?)(\n    </div>)'

_spec = importlib.util.spec_from_file_location('boss_vcore', ROOT / 'scripts/update-boss-vcore.py')
_boss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_boss)
esc = html.escape


def card(entry):
    name, full, core = esc(entry['name']), entry['description_full'], entry['core_desc'].replace('\n', '')
    searchable = ' '.join([entry['name'], entry['skill_code'], '被動 lv.200 被動 lv.200 特殊核心 全職業共通 v_matrix v_core_special',
                           entry['vcore_code'], full, core + '\n' + full, entry['icon_name']]).lower()
    meta = f"V 特殊核心 / 全職業共通 / VSkill / {entry['index']} / Open Lv 200 / MaxLv 1 / CoreLv 1"
    return f'''      <article class="skill-card is-collapsed" data-stage="lv200" data-type="passive" data-core="v_special" data-scope="all" data-text="{esc(searchable)}" role="button" tabindex="0" aria-expanded="false">
        <div class="skill-top">
          <div class="skill-icon" aria-hidden="true"><img src="{esc(entry['icon_file'])}" alt="{name}" loading="lazy"></div>
          <div class="skill-title">
            <h3>{name}</h3>
            <div class="skill-meta">{esc(meta)}</div>
          </div>
          <span class="type-pill">被動</span>
        </div>
        <div class="skill-divider"></div>
        <p class="skill-desc">{esc(core + chr(10) + full).replace(chr(10), '<br>')}</p>
      </article>'''


def update(text, data):
    text = re.sub(re.escape(GAP.rstrip(' ') + MARKER_START) + r'[\s\S]*?' + re.escape(MARKER_END), '', text)
    block_html = MARKER_START + '\n' + '\n    \n\n'.join(card(e) for e in data['cards']) + '\n      ' + MARKER_END
    stats = {'jobs': 0, 'removed': 0}

    def section(m):
        block = m.group(1)
        if 'data-core="v_boost"' not in block:
            return block

        def grid(g):
            body = g.group(2)
            cards = [c for c in re.finditer(CARD_RE, body) if 'data-core="v_special"' in c.group(0)]
            for c in reversed(cards):
                start, end = c.start(), c.end()
                if body[:start].endswith(GAP):      # normal case: drop the separator in front of the card
                    start -= len(GAP)
                elif body[end:].startswith(GAP):    # card is first in the grid: drop the separator behind it
                    end += len(GAP)
                body = body[:start] + body[end:]
                stats['removed'] += 1
            return g.group(1) + body + GAP.rstrip(' ') + block_html + g.group(3)

        block, n = re.subn(LV200_RE, grid, block, count=1)
        assert n == 1, m.group(2)
        stats['jobs'] += 1
        return _boss.recount(block)

    text = re.sub(JOB_RE, section, text)
    return _boss.recount_filters(text), stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.loads((ROOT / 'data/special-cores-2460.json').read_text(encoding='utf8'))
    assert len(data['cards']) == 5
    for entry in data['cards']:
        assert (ROOT / entry['icon_file']).stat().st_size > 100, entry['icon_file']
    path = ROOT / 'index.html'
    before = path.read_text(encoding='utf8')
    after, stats = update(before, data)
    assert stats['jobs'] == 48, stats
    again, stats2 = update(after, data)
    assert again == after and stats2['removed'] == 0, 'not idempotent'
    if args.check:
        if after != before:
            print('index.html is not up to date with data/special-cores-2460.json')
            sys.exit(1)
        print(f'OK: 5 special cores in {stats["jobs"]} jobs')
        return
    if after != before:
        path.write_text(after, encoding='utf8', newline='\n')
    print(json.dumps(stats))


if __name__ == '__main__':
    main()
