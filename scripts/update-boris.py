"""Idempotently add the limited-time TalesWeaver job 波里斯 (Boris) as its own job section.

data/boris-skills.json comes from Character/Job, Battle/SkillSet (Boris_BuySkillSet), Skill,
Client.Skill.DescriptionSet and the TWN language file of the Global/TWN client.
Boris has a skill tree only (Lv.3-215): no V Matrix, HEXA or Stella cards.

    python scripts/update-boris.py          # rewrite index.html
    python scripts/update-boris.py --check  # exit 1 if index.html is not up to date
"""
import argparse
import html
import importlib.util
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MARKER_START = '<!-- job-boris:start -->'
MARKER_END = '<!-- job-boris:end -->'
STAGES = [('lv1', 'Lv.1'), ('lv30', 'Lv.30'), ('lv60', 'Lv.60'), ('lv100', 'Lv.100'), ('hyper', '超技能')]
ANCHOR = '<section class="job-section" data-job="GenesisWeapon"'
OPTION_ANCHOR = '<option value="GenesisWeapon">'

_spec = importlib.util.spec_from_file_location('boss_vcore', ROOT / 'scripts/update-boss-vcore.py')
_boss = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_boss)
esc = html.escape


def card(skill, stage_label):
    name, desc = esc(skill['name']), skill['description']
    pill = skill['pill']
    searchable = ' '.join([skill['name'], skill['code'], pill, stage_label, pill + ' ', '職業專屬 skill_tree job_skill_set ',
                           desc, desc, skill['icon_name']]).lower()
    meta = f"技能樹 / 職業專屬 / {skill['layer']} / {skill['ui_sort']} / Open Lv {skill['open_level']} / MaxLv 1"
    return f'''      <article class="skill-card is-collapsed" data-stage="{skill['stage']}" data-type="{skill['type']}" data-core="none" data-scope="job" data-text="{esc(searchable)}" role="button" tabindex="0" aria-expanded="false">
        <div class="skill-top">
          <div class="skill-icon" aria-hidden="true"><img src="{esc(skill['icon_file'])}" alt="{name}" loading="lazy"></div>
          <div class="skill-title">
            <h3>{name}</h3>
            <div class="skill-meta">{esc(meta)}</div>
          </div>
          <span class="type-pill">{pill}</span>
        </div>
        <div class="skill-divider"></div>
        <p class="skill-desc">{esc(desc).replace(chr(10), '<br>')}</p>
      </article>'''


def section(data):
    job = data['job']
    stages = []
    for key, label in STAGES:
        skills = [s for s in data['skills'] if s['stage'] == key]
        if not skills:
            continue
        cards = '\n    \n\n'.join(card(s, label.lower()) for s in skills)
        stages.append(f'''                <section class="stage-section" data-stage-group="{key}">
                  <header class="stage-header">
                    <h3>{label}</h3>
                    <span>{len(skills)}</span>
                  </header>
                  <div class="skill-grid">
{cards}
    </div>
                </section>
                ''')
    searchable = esc(f"{job['code']} {job['name']} {job['note']}".lower())
    body = '\n'.join(stages)
    return f'''{MARKER_START}<section class="job-section" data-job="{job['code']}" data-text="{searchable}">
              <header class="job-header">
                <div>
                  <h2>{esc(job['name'])}</h2>
                </div>
                <span class="job-count">{len(data['skills'])} skills</span>
              </header>

{body}
            </section>

            {MARKER_END}'''


def update(text, data):
    job = data['job']
    text = re.sub(re.escape(MARKER_START) + r'[\s\S]*?' + re.escape(MARKER_END), '', text)
    option = f'<option value="{job["code"]}">{esc(job["name"])}</option>\n              '
    text = text.replace(option, '')
    assert text.count(ANCHOR) == 1 and text.count(OPTION_ANCHOR) == 1
    text = text.replace(ANCHOR, section(data) + ANCHOR, 1)
    text = text.replace(OPTION_ANCHOR, option + OPTION_ANCHOR, 1)
    jobs = len(re.findall(r'<section class="job-section" data-job="', text))
    text = re.sub(r'(<span><strong>)\d+(</strong> 個職業</span>)', lambda m: m[1] + str(jobs) + m[2], text)
    return _boss.recount_filters(text)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.loads((ROOT / 'data/boris-skills.json').read_text(encoding='utf8'))
    for skill in data['skills']:
        assert (ROOT / skill['icon_file']).stat().st_size > 100, skill['icon_file']
    path = ROOT / 'index.html'
    before = path.read_text(encoding='utf8')
    after = update(before, data)
    assert update(after, data) == after, 'not idempotent'
    if args.check:
        if after != before:
            print('index.html is not up to date with data/boris-skills.json')
            sys.exit(1)
        print(f'OK: {len(data["skills"])} Boris skills present')
        return
    if after != before:
        path.write_text(after, encoding='utf8', newline='\n')
    print(json.dumps({'skills': len(data['skills']), 'changed': after != before}))


if __name__ == '__main__':
    main()
