import numpy as np, soundfile as sf
sr=44100; rng=np.random.default_rng(11)
def mf(m): return 440*2**((m-69)/12)
class Mix:
    def __init__(s,sec): s.L=int(sec*sr); s.buf=np.zeros(s.L+sr*3)
    def add(s,sig,t):
        i=int(t*sr); n=min(len(sig),len(s.buf)-i); s.buf[i:i+n]+=sig[:n]
    def render(s,name,wet=.5,gain_db=-19):
        tail=s.buf[s.L:]; out=s.buf[:s.L].copy(); out[:len(tail)]+=tail
        ir=np.zeros(int(.4*sr))
        for d,a in [(.029,.22),(.047,.17),(.083,.12),(.131,.08),(.197,.05),(.29,.03),(.37,.02)]: ir[int(d*sr)]=a
        w=np.fft.irfft(np.fft.rfft(out,len(out)+len(ir))*np.fft.rfft(ir,len(out)+len(ir)))
        wt=w[s.L:]; w=w[:s.L]; w[:len(wt)]+=wt
        m=out+wet*w; m/=np.abs(m).max()/0.85
        sf.write(name+".wav",m.astype(np.float32),sr)
def env(n,a=.004,d=6.0):
    t=np.arange(n)/sr; return np.minimum(1,t/a)*np.exp(-t*d)
def kick(v=.6,f0=55,dec=12):
    t=np.arange(int(.35*sr))/sr; f=f0+110*np.exp(-t*35); return v*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-t*dec)
def nz(dur,amp,lo,hi,dec):
    n=int(dur*sr); x=rng.uniform(-1,1,n); X=np.fft.rfft(x); fr=np.fft.rfftfreq(n,1/sr); X[(fr<lo)|(fr>hi)]=0; x=np.fft.irfft(X,n); x/=np.abs(x).max()+1e-9
    return amp*x*np.exp(-np.arange(n)/sr*dec)
def snare(v=.35): return nz(.22,v,1500,7000,18)+ .25*v*np.sin(2*np.pi*190*np.arange(int(.22*sr))/sr)*np.exp(-np.arange(int(.22*sr))/sr*30)
def hat(v=.08,open_=False): return nz(.25 if open_ else .05, v, 6500, 14000, 9 if open_ else 70)
def clap(v=.25):
    c=np.zeros(int(.2*sr))
    for d in (0,.01,.021): s=nz(.17,v,900,4500,26); i=int(d*sr); c[i:i+len(s)]+=s[:len(c)-i]
    return c
def osc(f,dur,kind="sine",v=.2,a=.005,d=4.0,detune=0):
    t=np.arange(int(dur*sr))/sr
    if kind=="sine": y=np.sin(2*np.pi*f*t)
    elif kind=="saw": y=sum(np.sin(2*np.pi*f*k*t)/k for k in range(1,14))*.6
    elif kind=="square": y=sum(np.sin(2*np.pi*f*k*t)/k for k in range(1,14,2))*.8
    elif kind=="tri": y=sum(((-1)**((k-1)//2))*np.sin(2*np.pi*f*k*t)/k**2 for k in range(1,12,2))*.8
    if detune: y=.5*y+.5*np.sin(2*np.pi*f*(1+detune)*t)
    return v*y*np.minimum(1,t/a)*np.exp(-t*d)
def organ(f,dur,v=.12):
    t=np.arange(int(dur*sr))/sr; vib=1+.004*np.sin(2*np.pi*6.2*t)
    y=sum(a*np.sin(2*np.pi*f*h*vib*t) for h,a in [(.5,.6),(1,1),(2,.7),(3,.35),(4,.25),(6,.12)])
    e=np.minimum(1,t/.01)*np.minimum(1,(dur-t)/.03); click=np.exp(-t*400)*.3
    return v*(y*e+click*np.sin(2*np.pi*f*8*t))
def ep(f,dur,v=.14):  # electric-piano-ish
    t=np.arange(int(dur*sr))/sr
    y=np.sin(2*np.pi*f*t+ .8*np.exp(-t*5)*np.sin(2*np.pi*f*14*t))
    return v*y*np.minimum(1,t/.003)*np.exp(-t*3.2)

# ---------- 1. 嘻哈打卡 (boom-bap, 92 BPM, A minor) ----------
def hiphop():
    bpm=92; b=60/bpm; s16=b/4; bars=12; M=Mix(bars*4*b)
    chords=[[57,60,64,67],[53,57,60,64],[50,53,57,60],[52,56,59,62]]  # Am7 Fmaj7 Dm7 E7
    roots=[45,41,38,40]
    stab=[0,3,6,10,11]  # 16th positions per bar for piano stabs
    for bar in range(bars):
        t0=bar*4*b; ch=chords[bar%4]; r=roots[bar%4]
        for k in [0,7,10] + ([14] if bar%2 else []): M.add(kick(.7),t0+k*s16+ (0.012 if k%2 else 0))
        for k in [4,12]: M.add(snare(.38),t0+k*s16)
        for k in range(16):
            sw=.018 if k%2 else 0
            M.add(hat(.06 if k%2 else .09, open_=(k==14)),t0+k*s16+sw)
        for k in stab:
            for m in ch: M.add(ep(mf(m),.4,.07),t0+k*s16+(.015 if k%2 else 0))
        M.add(osc(mf(r),b*1.6,"sine",.32,d=1.6),t0); M.add(osc(mf(r),b*.9,"sine",.25,d=3),t0+10*s16)
        M.add(osc(mf(r+7),b*.6,"sine",.2,d=3),t0+14*s16)
    # vinyl crackle
    n=M.L; crack=np.zeros(n); idx=rng.integers(0,n,int(n/1800)); crack[idx]=rng.uniform(-.25,.25,len(idx)); M.add(crack*.4,0)
    M.render("t_hiphop",wet=.35)
    return bars*4*b
# ---------- 2. 放克迪斯科 (116 BPM, E minor-ish dorian) ----------
def funk():
    bpm=116; b=60/bpm; s16=b/4; bars=16; M=Mix(bars*4*b)
    prog=[(40,[64,67,71]),(40,[64,67,71]),(45,[64,69,72]),(47,[66,69,74])]
    bassline=[0,None,12,None,0,None,10,12,0,None,12,None,7,None,10,None]  # octave-jumping disco bass
    gtr=[2,6,10,14]
    hook=[[76,0,79,0,76,74,0,71],[74,0,76,0,0,0,0,0],[76,0,79,0,81,79,76,0],[79,0,76,74,71,0,74,0]]
    for bar in range(bars):
        t0=bar*4*b; r,ch=prog[bar%4]
        for q in range(4): M.add(kick(.65,50,14),t0+q*b)
        for q in (1,3): M.add(clap(.22),t0+q*b)
        for k in range(16): M.add(hat(.05,open_=(k%4==2)),t0+k*s16)
        for k,iv in enumerate(bassline):
            if iv is not None: M.add(osc(mf(r+iv),s16*1.6,"saw",.12,d=9),t0+k*s16)
        for k in gtr:
            for m in ch: M.add(osc(mf(m),s16*.7,"square",.025,d=28),t0+k*s16)
        if bar>=4:
            for i,m in enumerate(hook[bar%4]):
                if m: M.add(osc(mf(m),s16*1.8,"saw",.05,d=6,detune=.006),t0+i*2*s16)
    M.render("t_funk",wet=.4)
    return bars*4*b
# ---------- 3. 管风琴律动 (104 BPM shuffle, F) ----------
def organ_groove():
    bpm=104; b=60/bpm; bars=12; M=Mix(bars*4*b); tri=b/3
    prog=[(41,[65,69,72,75]),(46,[70,74,77,80]),(41,[65,69,72,75]),(48,[67,70,72,76])]
    walk=[[0,4,7,9],[0,2,4,5],[0,4,7,10],[0,7,5,4]]
    riff=[[77,0,0,80,81,0,77,0],[0,0,74,0,72,0,0,0],[77,0,80,81,84,0,81,77],[79,0,77,0,74,72,0,0]]
    for bar in range(bars):
        t0=bar*4*b; r,ch=prog[bar%4]
        for q in range(4):
            tq=t0+q*b
            if q in (0,2): M.add(kick(.55,52,13),tq)
            if q in (1,3): M.add(snare(.3),tq)
            M.add(hat(.07),tq); M.add(hat(.05),tq+2*tri)
            M.add(osc(mf(r-12+walk[bar%4][q]+12),b*.9,"tri",.22,d=2.5),tq)
        for q in (1,3):
            for m in ch: M.add(organ(mf(m),b*.55,.035),t0+q*b+2*tri*.0)
        for i,m in enumerate(riff[bar%4]):
            if m and bar>=2: M.add(organ(mf(m),tri*1.6,.06),t0+(i//2)*b+(i%2)*2*tri)
    M.render("t_organ",wet=.45)
    return bars*4*b
for f in (hiphop,funk,organ_groove): print(f.__name__, round(f(),2))
