from math import isfinite

def old_entry(momentum, dist20, dist_high, daily_rsv, daily_k, below_ma60, vr, up):
    e=82
    e-=max(0,dist20-5)*2.2
    e-=max(0,-dist20-5)*1.5
    if dist_high>-1:e-=8
    if daily_rsv>90:e-=8
    if daily_k>85:e-=5
    if below_ma60:e-=10
    if momentum<55:e-=8
    if -3<=dist20<=8:e+=8
    if vr>1.2 and up:e+=4
    return round(max(0,min(100,e)))

def new_entry(f):
    z20,z60=f['z20'],f['z60']; structure=f['structure']
    loc20=2 if z20<-2 else 7 if z20<-1 else 18 if z20<=.75 else 14 if z20<=1.5 else 9 if z20<=2.25 else 5 if z20<=3 else 1
    loc60=0 if f.get('below_ma60',False) else 5 if z60<=3 else 4 if z60<=5 else 2 if z60<=7 else 0
    loc200=2 if f.get('above_ma200',True) else 0
    location=min(25,loc20+loc60+loc200)
    s=f['supportAtr']; support=15 if s<=.5 else 13 if s<=1 else 10 if s<=1.5 else 7 if s<=2 else 4 if s<=3 else 1
    rr=f['rr']; rr_score=15 if rr>=3 else 13 if rr>=2 else 11 if rr>=1.5 else 8 if rr>=1 else 6 if rr>=.7 else 4 if rr>=.4 else 3
    vr=f['vol_ratio']; near=f.get('near_resistance',False); br=f.get('is_breakout',False); pull=f.get('pullback',False)
    if near or br: volume=10 if vr>=1.2 else 8 if vr>=1 else 6 if vr>=.8 else 4 if vr>=.6 else 2
    elif pull: volume=10 if vr<=.8 else 8 if vr<=1 else 6 if vr<=1.2 else 4
    else: volume=7 if vr>=1 else 6 if vr>=.7 else 5
    wr,wk=f['weekly_rsv'],f['weekly_k']; weekly=2 if wr>95 else 4 if wr>90 else 6 if wr>85 else 8 if wr>75 else 10 if wr>=30 else 7 if wr>=20 else 5
    if wk>90: weekly=min(weekly,3)
    elif wk>85: weekly=min(weekly,4)
    broken=f.get('broken',False); retest=f.get('retest',False); confirmed=f.get('confirmed_breakout',False); healthy=f.get('healthy_pullback',False); pre=f.get('prebreakout',False)
    extended=z20>2 or z60>5 or (wr>90 and z20>1.25)
    stage=1 if broken else 5 if (retest or confirmed or healthy) else 4 if pre else 3
    raw=structure+location+support+rr_score+volume+weekly+stage; cap=100
    if wr>95 and z20>1.5:cap=min(cap,65)
    if z60>5 and z20>1.25:cap=min(cap,65)
    if near and vr<.8:cap=min(cap,60)
    if br and vr<.9 and not retest:cap=min(cap,65)
    if z20>3 or z60>8:cap=min(cap,50)
    if f.get('below_ma60',False) and f.get('ma20_below_ma60',False):cap=min(cap,45)
    return round(min(raw,cap))

F={
'PLTR':((87,7.08,-1.06,89.78,80.33,False,.45,True),dict(structure=20,z20=1.81,z60=6.42,supportAtr=1.81,rr=.14,vol_ratio=.45,weekly_rsv=97.18,weekly_k=88.10,near_resistance=True)),
'GLD':((88,6.2,-.4,87,83,False,.72,True),dict(structure=20,z20=1.7,z60=5.6,supportAtr=1.5,rr=.35,vol_ratio=.72,weekly_rsv=93,weekly_k=86,near_resistance=True)),
'MSFT':((72,1.8,-4,45,55,False,.78,False),dict(structure=20,z20=.55,z60=3.2,supportAtr=.55,rr=2.0,vol_ratio=.78,weekly_rsv=66,weekly_k=62,pullback=True,healthy_pullback=True)),
'GOOGL':((64,.8,-3,55,52,False,1.0,True),dict(structure=16,z20=.35,z60=1.8,supportAtr=.7,rr=1.8,vol_ratio=1.0,weekly_rsv=58,weekly_k=55)),
'SOXX':((58,-1,-8,35,42,False,.72,False),dict(structure=15,z20=-.4,z60=.8,supportAtr=.45,rr=1.6,vol_ratio=.72,weekly_rsv=38,weekly_k=41,pullback=True,healthy_pullback=True)),
'META':((30,-4,-10,18,28,True,1.1,False),dict(structure=5,z20=-1.2,z60=-2,supportAtr=.7,rr=1.2,vol_ratio=1.1,weekly_rsv=24,weekly_k=30,broken=True,below_ma60=True,above_ma200=False,ma20_below_ma60=True)),
'VOO':((68,1.2,-1.5,70,72,False,.9,True),dict(structure=20,z20=.6,z60=2.0,supportAtr=.6,rr=1.2,vol_ratio=.9,weekly_rsv=70,weekly_k=68,prebreakout=True)),
'MU':((70,2,-4,55,60,False,.8,False),dict(structure=20,z20=.5,z60=3.5,supportAtr=.5,rr=1.8,vol_ratio=.8,weekly_rsv=65,weekly_k=62,pullback=True,healthy_pullback=True)),
}
expected={'PLTR':(48,60),'GLD':(50,64),'MSFT':(80,100),'GOOGL':(75,95),'SOXX':(78,100),'META':(0,45),'VOO':(75,95),'MU':(80,100)}
print('ticker old new')
for t,(oldargs,nf) in F.items():
    o=old_entry(*oldargs); n=new_entry(nf); lo,hi=expected[t]
    print(t,o,n)
    assert lo<=n<=hi,(t,n,(lo,hi))
assert old_entry(*F['PLTR'][0])==85
assert 48<=new_entry(F['PLTR'][1])<=60
assert new_entry(F['META'][1])<=45
assert new_entry(F['MSFT'][1])>=80
print('PASS: semantic regression fixtures')
