import sys, re
p='PLAN.md'
lines=open(p,encoding='utf-8').read().split('\n')
out=[];i=0;n=0
while i<len(lines):
    if lines[i].startswith('<<<<<<< '):
        n+=1; ours=[];theirs=[];i+=1
        while not lines[i].startswith('======='): ours.append(lines[i]); i+=1
        i+=1
        while not lines[i].startswith('>>>>>>> '): theirs.append(lines[i]); i+=1
        i+=1
        ours=[x for x in ours if x.strip()]; theirs=[x for x in theirs if x.strip()]
        # Drop anything from `theirs` already present in `ours` (old-numbered dupes),
        # and drop old-numbered SQ rows whose renumbered twin exists.
        keep=[]
        for t in theirs:
            m=re.match(r'\| SQ-(\d+) \| (.{0,60})', t)
            if m:
                body=m.group(2)
                if any(body in o for o in ours): continue
            if t in ours: continue
            keep.append(t)
        out.extend(ours+keep)
        continue
    out.append(lines[i]); i+=1
open(p,'w',encoding='utf-8').write('\n'.join(out))
print(f"resolved {n} conflict block(s)")
