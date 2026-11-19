# python3 roll.py in.json outdir   -> one piano-roll style PNG per beat
import json,sys,os
import numpy as np, matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
data=json.load(open(sys.argv[1])); od=sys.argv[2]; os.makedirs(od,exist_ok=True)
ORDER=['kick','snare','clap','rim','hat','openhat','shaker','perc','bell','bass','logdrum','chords','pad','pluck','lead']
for bi,b in enumerate(data):
    bars=b['bars']; nb=len(bars); fig,ax=plt.subplots(figsize=(max(10,nb*0.55),4.6))
    for ti,tn in enumerate(ORDER):
        for bi2,bar in enumerate(bars):
            tr=bar['tracks'].get(tn); ve=(bar['vel'] or {}).get(tn)
            if not tr: continue
            for s,h in enumerate(tr):
                if h:
                    v=ve[s] if ve else 0.7
                    ax.add_patch(plt.Rectangle((bi2*16+s,ti-0.4),0.85,0.8,color=plt.cm.viridis(min(1,max(0.1,v)))))
                    d=(bar.get('dbl') or {}).get(tn,{}).get(str(s))
                    if d: ax.plot([bi2*16+s+0.9],[ti],marker='>' if d=='double' else 'D',color='tab:red',ms=3)
    x=0
    for bar in bars:
        pass
    last=None; 
    for bi2,bar in enumerate(bars):
        ax.axvline(bi2*16,color='#888',lw=0.4)
        k=bar['kind']
        if k!=last: ax.text(bi2*16+0.5,len(ORDER)-0.3,(bar.get('label') or k),fontsize=7,va='bottom'); last=k
        fx=bar.get('fx') or {}
        tags=[n for n in ('impact','crash','reverse','sweep') if fx.get(n)]
        if tags: ax.text(bi2*16+0.5,-1.1,'+'.join(t[:3] for t in tags),fontsize=5,color='tab:red')
    ax.set_yticks(range(len(ORDER))); ax.set_yticklabels(ORDER,fontsize=7); ax.set_xlim(0,nb*16); ax.set_ylim(-1.4,len(ORDER)+0.3)
    ax.set_xticks([i*16 for i in range(nb)]); ax.set_xticklabels([str(i+1) for i in range(nb)],fontsize=6)
    sp=b.get('spice'); sp_t=(sp['name']+' | '+sp['lift']['name']+' | '+sp['extra']['name']) if sp and sp.get('name') else 'no spice'
    ax.set_title(f"{b['genre']}/{b['style']}  {b['bpm']} bpm  swing {b.get('swing')}   spice: {sp_t}",fontsize=9)
    plt.tight_layout(); plt.savefig(f"{od}/{bi:02d}_{b['genre']}_{b['style']}_{b['seed']}.png",dpi=110); plt.close()
print('ok')
