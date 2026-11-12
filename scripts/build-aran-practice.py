import json,re,html,subprocess
from pathlib import Path
W=Path('C:/Users/jc/Documents/Codex/2026-08-01/maplestorym-stella-publish-20260914')
A=Path('C:/Users/jc/Documents/Codex/2026-08-01/https-jc1maple-github-io-maplestorym-global/aran-simulator-data.js')
src=A.read_text(encoding='utf8')
obj=src[src.index('const data = ')+13:]
# find matching brace
depth=0
for i,ch in enumerate(obj):
    if ch=='{': depth+=1
    elif ch=='}':
        depth-=1
        if depth==0: obj=obj[:i+1]; break
d=json.loads(obj)
site=(W/'index.html').read_text(encoding='utf8')
sec=re.search(r'<section class="job-section" data-job="Aran"[\s\S]*?(?=<section class="job-section")',site).group(0)
cards=re.findall(r'<article class="skill-card\b[\s\S]*?</article>',sec)
def find(code):
    stem=re.sub(r'_\d+$','',code).lower()
    for c in cards:
        dt=re.search(r'data-text="([^"]*)"',c).group(1)
        if re.search(r'\b'+re.escape(stem)+r'_\d+\b',dt): return c
out=[]
for k,s in d['skills'].items():
    c=find(s['code'])
    pv=None
    if c and 'data-preview-src' in c:
        g=lambda n: html.unescape(re.search(r'data-preview-'+n+r'="([^"]*)"',c).group(1))
        if g('kind')=='spritesheet':
            pv={'src':g('src'),'frames':int(g('frames')),'cols':int(g('cols')),'rows':int(g('rows')),'w':int(g('width')),'h':int(g('height')),'durations':[int(x) for x in g('durations').split(',')]}
    desc=s.get('description','')
    num=lambda p: (re.search(p,desc) or [None,None])[1]
    out.append({'id':k,'code':s['code'],'name':s['name'],'group':s['group'],'icon':s['icon'],'actionMs':s.get('actionMs'),'lockMs':s.get('lockMs'),'hitOffsetMs':s.get('hitOffsetMs'),'cooldownMs':s.get('cooldownMs'),
      'background':s.get('background'),'combo':s.get('combo'),'damage':num(r'技能傷害: ([\d.]+)%'),'hits':num(r'打擊次數: (\d+)'),'targets':num(r'目標人數: (\d+)'),'mechanics':s.get('mechanics',''),'preview':pv})
for o in out: print(o['id'],o['name'],o['group'],o['actionMs'],o['lockMs'],o['cooldownMs'],o['damage'],o['hits'],'PV' if o['preview'] else '-', o['icon'], (W/o['icon']).exists())
json.dump({'source':d['version'],'modelStatus':d['modelStatus'],'skills':out},open('aran-practice.json','w',encoding='utf8'),ensure_ascii=False,indent=1)
