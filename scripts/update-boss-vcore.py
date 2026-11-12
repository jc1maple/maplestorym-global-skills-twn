"""Idempotently add boss V-core skill cards (e.g. 太陽之冠) to every job section.

Reads data/boss-vcore-skills.json (exported from the Global/TWN client tables
VMatrix/VCoreSkill_VSkill + Client.Skill.DescriptionSet + TWN language) and inserts
one card per job right after the anchor card named by `insert_after`.
All other markup is kept byte-for-byte; only the job / Lv.200 counters are recounted.

    python scripts/update-boss-vcore.py          # rewrite index.html
    python scripts/update-boss-vcore.py --check  # exit 1 if index.html is not up to date
"""
import argparse
import hashlib
import html
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER_START = '<!-- boss-vcore:start -->'
MARKER_END = '<!-- boss-vcore:end -->'
CARD_RE = r'<article class="skill-card\b[\s\S]*?</article>'
JOB_RE = r'(<section class="job-section" data-job="([^"]+)"[\s\S]*?)(?=<section class="job-section"|<div id="skill-preview-popover")'


def card(skill):
    esc = html.escape
    name = esc(skill['name'])
    full = skill['description_full']
    searchable = ' '.join([
        skill['name'], skill['code'], '主動 lv.200 主動 lv.200 技能核心 全職業共通 v_matrix v_core_job_skill',
        skill['vcore_code'], full, skill['core_desc'] + '\n' + full, skill['icon_name'],
    ]).lower()
    description = esc(skill['core_desc'] + '\n' + full).replace('\n', '<br>')
    preview = skill.get('preview')
    icon_attrs = 'class="skill-icon" aria-hidden="true"'
    if preview:
        # One shared sheet for all jobs (the skill is common); same attribute contract as the other spritesheet previews.
        src = esc(f"{preview['preview']}?v={preview['asset_hash']}")
        icon_attrs = (
            f'class="skill-icon has-preview" aria-hidden="true" title="技能動畫預覽" data-preview-src="{src}" data-preview-sources="{src}" '
            f'data-preview-kind="spritesheet" data-preview-frames="{preview["frame_count"]}" data-preview-width="{preview["frame_width"]}" '
            f'data-preview-height="{preview["frame_height"]}" data-preview-cols="{preview["sheet_columns"]}" data-preview-rows="{preview["sheet_rows"]}" '
            f'data-preview-durations="{",".join(str(d) for d in preview["durations_ms"])}" data-preview-format="{esc(preview["format"])}" '
            f'data-preview-animation="{esc(preview["animation"])}"'
        )
    meta = f"V 技能核心 / 全職業共通 / VSkill / {skill['vcore_index']} / Open Lv 200 / MaxLv {skill['max_level']} / CoreLv {skill['max_level']}"
    return f'''{MARKER_START}
      <article class="skill-card is-collapsed" data-stage="lv200" data-type="active" data-core="v_skill" data-scope="all" data-text="{esc(searchable)}" role="button" tabindex="0" aria-expanded="false">
        <div class="skill-top">
          <div {icon_attrs}><img src="{esc(skill['icon_file'])}" alt="{name}" loading="lazy"></div>
          <div class="skill-title">
            <h3>{name}</h3>
            <div class="skill-meta">{esc(meta)}</div>
          </div>
          <span class="type-pill">主動</span>
        </div>
        <div class="skill-divider"></div>
        <p class="skill-desc">{description}</p>
      </article>
      {MARKER_END}'''


def recount(block):
    total = len(re.findall(r'<article class="skill-card\b', block))
    block = re.sub(r'(<span class="job-count">)\d+( skills</span>)', lambda m: m[1] + str(total) + m[2], block, count=1)

    def stage(m):
        body = m.group(0)
        n = len(re.findall(r'<article class="skill-card\b', body))
        return re.sub(r'(<header class="stage-header">\s*<h3>Lv\.200</h3>\s*<span>)\d+(</span>)', lambda x: x[1] + str(n) + x[2], body, count=1)

    return re.sub(r'<section class="stage-section" data-stage-group="lv200">[\s\S]*?(?=<section class="stage-section"|$)', stage, block, count=1)


def update(text, data):
    text = re.sub(r'\n    \n\n      ' + re.escape(MARKER_START) + r'[\s\S]*?' + re.escape(MARKER_END), '', text)
    covered = []

    def section(m):
        block, job = m.group(1), m.group(2)
        changed = False
        for skill in data['skills']:
            anchor = next((c for c in re.finditer(CARD_RE, block)
                           if re.search(r'data-text="[^"]*\b' + re.escape(skill['insert_after']) + r'\b', c.group(0))), None)
            if anchor is None:
                continue
            block = block[:anchor.end()] + '\n    \n\n      ' + card(skill) + block[anchor.end():]
            changed = True
        if changed:
            covered.append(job)
        return recount(block) if changed else block

    text = re.sub(JOB_RE, section, text)
    return recount_filters(text), covered


def recount_filters(text):
    """Header total and sidebar filter counters, recomputed from the cards (same rule as update-stella-skills.py)."""
    attrs = re.findall(r'<article class="skill-card\b[^>]*', text)
    text = re.sub(r'(<span><strong>)[\d,]+(</strong> 筆技能</span>)', lambda m: m[1] + f'{len(attrs):,}' + m[2], text)
    counts = {key: Counter(re.search('data-' + key + r'="([^"]+)"', a)[1] for a in attrs) for key in ['stage', 'type', 'core', 'scope']}

    def filter_count(m):
        label = m[0]
        match = re.search(r'class="(stage|type|core|scope)-check"[^>]*value="([^"]+)"', label)
        if match:
            count = counts[match[1]][match[2]]
        elif re.search(r'id="(?:stage|type|core|scope)-all"', label):
            count = len(attrs)
        else:
            return label
        return re.sub(r'<strong>\d+</strong>', f'<strong>{count}</strong>', label)

    return re.sub(r'<label class="filter-row">[\s\S]*?</label>', filter_count, text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.loads((ROOT / 'data/boss-vcore-skills.json').read_text(encoding='utf8'))
    for skill in data['skills']:
        assert (ROOT / skill['icon_file']).stat().st_size > 100, skill['icon_file']
        if skill.get('preview'):
            sheet = (ROOT / skill['preview']['preview']).read_bytes()
            assert hashlib.sha256(sheet).hexdigest()[:12] == skill['preview']['asset_hash'], 'preview hash mismatch'
    path = ROOT / 'index.html'
    raw = path.read_bytes()
    newline = '\r\n' if b'\r\n' in raw else '\n'
    text = raw.decode('utf8').replace('\r\n', '\n')
    updated, covered = update(text, data)
    assert len(covered) == 48, (len(covered), covered)
    out = updated.replace('\n', newline).encode('utf8')
    if args.check:
        if out != raw:
            print('index.html is not up to date with data/boss-vcore-skills.json')
            sys.exit(1)
        print(f'OK: {len(data["skills"])} boss V-core skill(s) present in {len(covered)} jobs')
        return
    path.write_bytes(out)
    print(f'Updated {len(covered)} jobs with {len(data["skills"])} boss V-core skill(s)')


if __name__ == '__main__':
    main()
