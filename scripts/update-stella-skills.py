"""Idempotently update Stella cards without regenerating other skills or the UI.

Input is the Global/TWN export from Skill, DescriptionSet, TWN language,
Character/Job and ConstellaCore/Page; icons must already be extracted.
"""
import argparse
import html
import json
import re
from collections import Counter
from pathlib import Path

MARKER_START='<!-- stella-code:start -->'
MARKER_END='<!-- stella-code:end -->'

def card(skill):
    esc=html.escape
    name=esc(skill['name'])
    searchable=' '.join([skill['name'],skill['code'],'星辰代碼 職業群共通 主動 Lv.250',skill['description_full']]).lower()
    description=esc('技能等級：Lv.30\n'+skill['description_full']).replace('\n','<br>')
    return f'''{MARKER_START}
                <section class="stage-section" data-stage-group="stella">
                  <header class="stage-header"><h3>星辰代碼</h3><span>1</span></header>
                  <div class="skill-grid">
                    <article class="skill-card is-collapsed" data-stage="stella" data-type="active" data-core="none" data-scope="class" data-text="{esc(searchable)}" role="button" tabindex="0" aria-expanded="false">
                      <div class="skill-top">
                        <div class="skill-icon" aria-hidden="true"><img src="{esc(skill['icon_file'])}" alt="{name}" loading="lazy"></div>
                        <div class="skill-title"><h3>{name}</h3><div class="skill-meta">星辰代碼 / 職業群共通 / Open Lv 250 / MaxLv 30</div></div>
                        <span class="type-pill">主動</span>
                      </div>
                      <div class="skill-divider"></div>
                      <p class="skill-desc">{description}</p>
                    </article>
                  </div>
                </section>
                {MARKER_END}
'''

def update(text,data):
    # Strip only our generated blocks, keeping all unrelated markup byte-for-byte.
    text=re.sub(re.escape(MARKER_START)+r'.*?'+re.escape(MARKER_END)+r'\n','',text,flags=re.S)
    skills={s['code']:s for s in data['skills']}
    pattern=r'(<section class="job-section" data-job="([^"]+)"[\s\S]*?)(?=<section class="job-section"|<div id="skill-preview-popover")'
    covered=[]
    def section(m):
        block,job=m.group(1),m.group(2)
        mapping=data['job_mapping'].get(job)
        if not mapping:
            assert job=='GenesisWeapon',f'Missing job mapping: {job}'
            return block
        skill=skills[mapping['skill_code']]
        anchor='<section class="stage-section" data-stage-group="other">'
        assert anchor in block,f'Missing insertion point for {job}'
        block=block.replace(anchor,card(skill)+anchor,1)
        count=len(re.findall(r'<article class="skill-card\b',block))
        block=re.sub(r'(<span class="job-count">)\d+( skills</span>)',lambda x:x[1]+str(count)+x[2],block)
        covered.append(job)
        return block
    text=re.sub(pattern,section,text)
    assert len(covered)==48,covered
    if 'class="stage-check" type="checkbox" value="stella"' not in text:
        anchor=r'(<label class="filter-row">\s*<input class="stage-check" type="checkbox" value="lv250">[\s\S]*?</label>)'
        text,n=re.subn(anchor,r'\1\n        <label class="filter-row"><input class="stage-check" type="checkbox" value="stella"><span>星辰代碼</span><strong>48</strong></label>',text,count=1)
        assert n==1
    attrs=re.findall(r'<article class="skill-card\b[^>]*',text)
    text=re.sub(r'(<span><strong>)[\d,]+(</strong> 筆技能</span>)',lambda m:m[1]+f'{len(attrs):,}'+m[2],text)
    counts={key:Counter(re.search('data-'+key+r'="([^"]+)"',a)[1] for a in attrs) for key in ['stage','type','core','scope']}
    def filter_count(m):
        label=m[0]
        match=re.search(r'class="(stage|type|core|scope)-check"[^>]*value="([^"]+)"',label)
        if match:count=counts[match[1]][match[2]]
        elif re.search(r'id="(?:stage|type|core|scope)-all"',label):count=len(attrs)
        else:return label
        return re.sub(r'<strong>\d+</strong>',f'<strong>{count}</strong>',label)
    text=re.sub(r'<label class="filter-row">[\s\S]*?</label>',filter_count,text)
    return text,covered

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--site',type=Path,default=Path(__file__).resolve().parents[1])
    parser.add_argument('--data',type=Path)
    args=parser.parse_args()
    site=args.site.resolve();data_path=args.data or site/'data/stella-skills.json'
    data=json.loads(data_path.read_text(encoding='utf-8'))
    assert len(data['skills'])==5
    for skill in data['skills']:
        assert len(skill['levels'])==30
        assert (site/skill['icon_file']).is_file(),skill['icon_file']
    path=site/'index.html';before=path.read_text(encoding='utf-8')
    after,covered=update(before,data)
    assert update(after,data)[0]==after,'Generator is not idempotent'
    if after!=before:path.write_text(after,encoding='utf-8',newline='\n')
    print(json.dumps({'jobs_updated':len(covered),'skills':5,'level_rows':150},ensure_ascii=False))

if __name__=='__main__':main()
