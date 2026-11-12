"""Idempotently bring the V enhancement-core cards in line with the 2.460 V Matrix revamp.

data/vcore-enhancement-2460.json (from VMatrix/VCoreSkill/VCoreSkill_Enhancement):
  existing: cards already on the site -> new index, core number (JobSet.Num) and per-level damage line
  new:      enhancement rows that had no card -> inserted in table order inside the job's Lv.200 section,
            reusing the icon / animation preview / type of the job's own card for the same skill

    python scripts/update-vcore-enhancement.py          # rewrite index.html
    python scripts/update-vcore-enhancement.py --check  # exit 1 if index.html is not up to date
"""
import argparse
import html
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER_START = '<!-- vcore-enh:start -->'
MARKER_END = '<!-- vcore-enh:end -->'
GAP = '\n    \n\n      '
CARD_RE = r'<article class="skill-card\b[\s\S]*?</article>'
JOB_RE = r'(<section class="job-section" data-job="([^"]+)"[\s\S]*?)(?=<section class="job-section"|<div id="skill-preview-popover")'

_spec = importlib.util.spec_from_file_location('boss_vcore', ROOT / 'scripts/update-boss-vcore.py')
_boss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_boss)
esc = html.escape


def new_meta(entry, old_meta):
    parts = old_meta.split(' / ')
    if not entry['group']:
        return old_meta  # legacy row outside the six-core layout (kept by the client, not renumbered)
    parts[0] = f"V 強化核心 {entry['group']}"
    parts[3] = entry['index']
    return ' / '.join(parts)


def token(card):
    m = re.search(r'v_core_enhancement (\S+)', html.unescape(re.search(r'data-text="([^"]*)"', card).group(1)))
    return m.group(1) if m else None


def refresh_existing(card, entry):
    old_meta, meta = esc(entry['old_meta']), esc(new_meta(entry, entry['old_meta']))
    if meta not in card:
        assert card.count(old_meta) == 1, ('meta', entry['vcore_code'])
        card = card.replace(old_meta, meta)
    if entry['old_summary'] != entry['summary']:
        old_body, body = esc(entry['old_summary']).replace('\n', '<br>'), esc(entry['summary']).replace('\n', '<br>')
        if body not in card:
            assert card.count(old_body) == 1, ('summary', entry['vcore_code'])
            card = card.replace(old_body, body).replace(esc(entry['old_summary']).lower(), esc(entry['summary']).lower())
    return card


def new_card(entry, cards):
    skill = entry['skill_code'].lower()
    pattern = r'data-text="[^"]*\b' + re.escape(skill) + r'\b'
    base = next((c for c in cards if 'data-core="none"' in c and re.search(pattern, c)), None) or next((c for c in cards if re.search(pattern, c)), None)
    name = esc(entry['name'])
    if base:
        icon = re.search(r'<div class="skill-icon[\s\S]*?</div>', base).group(0)
        icon = re.sub(r'alt="[^"]*"', f'alt="{name}"', icon, count=1)
        dtype = re.search(r'data-type="([^"]+)"', base).group(1)
        pill = re.search(r'<span class="type-pill">(.*?)</span>', base).group(1)
    else:
        icon_file = f"icons/{entry['core_icon']}.png"
        assert (ROOT / icon_file).stat().st_size > 100, icon_file
        icon = f'<div class="skill-icon" aria-hidden="true"><img src="{esc(icon_file)}" alt="{name}" loading="lazy"></div>'
        dtype, pill = 'active', '主動'
    full, summary = entry['description_full'], entry['summary']
    searchable = ' '.join([entry['name'], entry['skill_code'], f'{pill} lv.200 {pill} lv.200 強化核心 職業專屬 v_matrix v_core_enhancement',
                           entry['vcore_code'], full, summary + '\n' + full, entry['core_icon']]).lower()
    meta = f"V 強化核心 {entry['group']} / 職業專屬 / VSkill / {entry['index']} / Open Lv 200 / MaxLv {entry['max_level']} / CoreLv 60"
    description = esc(summary + '\n' + full).replace('\n', '<br>')
    return f'''{MARKER_START}
      <article class="skill-card is-collapsed" data-stage="lv200" data-type="{dtype}" data-core="v_boost" data-scope="job" data-text="{esc(searchable)}" role="button" tabindex="0" aria-expanded="false">
        <div class="skill-top">
          {icon}
          <div class="skill-title">
            <h3>{name}</h3>
            <div class="skill-meta">{esc(meta)}</div>
          </div>
          <span class="type-pill">{pill}</span>
        </div>
        <div class="skill-divider"></div>
        <p class="skill-desc">{description}</p>
      </article>
      {MARKER_END}'''


def update(text, data):
    text = re.sub(re.escape(GAP + MARKER_START) + r'[\s\S]*?' + re.escape(MARKER_END), '', text)
    text = re.sub(re.escape(MARKER_START) + r'[\s\S]*?' + re.escape(MARKER_END) + re.escape(GAP), '', text)
    existing = {e['vcore_code'].lower(): e for e in data['existing']}
    by_job = {}
    for entry in data['new']:
        by_job.setdefault(entry['job'], []).append(entry)
    stats = {'existing': 0, 'new': 0}

    def section(m):
        block, job = m.group(1), m.group(2)

        def refresh(card_match):
            card = card_match.group(0)
            if 'data-core="v_boost"' not in card:
                return card
            entry = existing.get(token(card))
            if not entry:
                return card
            stats['existing'] += 1
            return refresh_existing(card, entry)

        block = re.sub(CARD_RE, refresh, block)
        for entry in by_job.get(job, []):
            cards = [c for c in re.finditer(CARD_RE, block)]
            html_card = new_card(entry, [c.group(0) for c in cards])
            boosts = [c for c in cards if 'data-core="v_boost"' in c.group(0)]
            if entry['insert_after']:
                anchor = next(c for c in boosts if token(c.group(0)) == entry['insert_after'].lower())
                end = anchor.end()
                if block[end:end + len(GAP) + len(MARKER_END) + 7].lstrip().startswith(MARKER_END):
                    end = block.index(MARKER_END, end) + len(MARKER_END)
                block = block[:end] + GAP + html_card + block[end:]
            else:
                start = boosts[0].start()
                block = block[:start] + html_card + GAP + block[start:]
            stats['new'] += 1
        return _boss.recount(block) if job in by_job else block

    text = re.sub(JOB_RE, section, text)
    return _boss.recount_filters(text), stats


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.loads((ROOT / 'data/vcore-enhancement-2460.json').read_text(encoding='utf8'))
    path = ROOT / 'index.html'
    before = path.read_text(encoding='utf8')
    after, stats = update(before, data)
    assert stats == {'existing': len(data['existing']), 'new': len(data['new'])}, stats
    assert update(after, data)[0] == after, 'not idempotent'
    if args.check:
        if after != before:
            print('index.html is not up to date with data/vcore-enhancement-2460.json')
            sys.exit(1)
        print(f'OK: {stats}')
        return
    if after != before:
        path.write_text(after, encoding='utf8', newline='\n')
    print(json.dumps(stats))


if __name__ == '__main__':
    main()
