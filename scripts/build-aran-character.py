"""Export NPC_Aran_05 (Stand / Move / Alert / Attack_01) as transparent sheets with a shared foot anchor."""
import sys, json
from pathlib import Path
sys.path.insert(0,'C:/Users/jc/Documents/Codex/2026-08-01/maplestorym-lara-update-work/work')
import build_all_skill_ezpacked_previews as B
from PIL import Image
HERE=Path(__file__).resolve().parent
atlas=Image.open(HERE/'virt_b.png')
env=B.load_bundle('1097615.msm'); objs={o.path_id:o for o in env.objects}
root=env.container['assets/bundleresources/dummyobject/npc/defaultscene/timelane/npc_aran_05.prefab']
def walk(go):
    yield go
    tr=next((c for c in B.game_object_components(objs,go) if c.type.name=='Transform'),None)
    for ch in (tr.read_typetree().get('m_Children',[]) if tr else []):
        yield from walk(objs[objs[ch['m_PathID']].read_typetree()['m_GameObject']['m_PathID']])
ez=None
for g in walk(root):
    for c in B.game_object_components(objs,g):
        if c.type.name=='MonoBehaviour':
            try: t=c.read_typetree()
            except Exception: continue
            if B.script_class(objs,t)=='EzPackedSprite' and t.get('textureAnimations'): ez=t
anims={a['name']:a for a in ez['textureAnimations']}
want=['Stand','Move','Alert','Attack_01']
recs={}
for name in want:
    a=anims[name]; fr=[]
    for i,f in enumerate(a['spriteFrames']):
        crop=B.crop_frame(atlas,f); rect=B.frame_rect(f)
        d=(a.get('frameDuration') or [])
        fr.append((crop,rect,round(float(d[i])*1000) if i<len(d) else round(float(f.get('timeDuration',0.1))*1000)))
    recs[name]=fr
    print(name,len(fr),[r[1] for r in fr[:2]],[r[0].size for r in fr[:2]],[r[2] for r in fr[:4]])
px={}
for name,fr in recs.items():
    px[name]=[]
    for crop,rect,d in fr:
        p=crop.size[0]/(rect[2]-rect[0])          # pixels per unit differs between frames: place by the frame's own scale
        px[name].append((crop,rect[0]*p,-rect[1]*p,d))
L=min(x for v in px.values() for _,x,_,_ in v); T=min(y for v in px.values() for _,_,y,_ in v)
R=max(x+c.size[0] for v in px.values() for c,x,_,_ in v); Bm=max(y+c.size[1] for v in px.values() for c,_,y,_ in v)
Wc=int(round(R-L))+2; Hc=int(round(Bm-T))+2
meta={'frameWidth':Wc,'frameHeight':Hc,'originX':round(-L),'originY':round(-T),'facing':'left','animations':{}}
total=sum(len(v) for v in px.values()); cols=6; rows=(total+cols-1)//cols
sheet=Image.new('RGBA',(Wc*cols,Hc*rows),(0,0,0,0)); k=0
for name,fr in px.items():
    meta['animations'][name]={'start':k,'count':len(fr),'durations':[d for *_,d in fr]}
    for crop,x,y,d in fr:
        sheet.paste(crop,((k%cols)*Wc+int(round(x-L)),(k//cols)*Hc+int(round(y-T))),crop); k+=1
meta['columns']=cols
sheet.save(HERE/'aran_char.png',optimize=True); json.dump(meta,open(HERE/'aran_char.json','w'),indent=1)
print(meta['frameWidth'],meta['frameHeight'],meta['originX'],meta['originY'],sheet.size,(HERE/'aran_char.png').stat().st_size)
sheet.crop((0,Hc,Wc*6,Hc*3)).resize((Wc*6//2,Hc)).save(HERE/'aran_char_preview.png')
