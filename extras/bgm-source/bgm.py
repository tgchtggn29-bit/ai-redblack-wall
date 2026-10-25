import numpy as np, soundfile as sf
sr=44100; bpm=160; beat=60/bpm; e8=beat/2; bars=16; L=int(bars*4*beat*sr)
rng=np.random.default_rng(3)
out=np.zeros(L+sr*2)
def mf(m): return 440*2**((m-69)/12)
def add(sig,t):
    i=int(t*sr); out[i:i+len(sig)]+=sig[:len(out)-i]
def pluck(f,dur=.5,amp=.18,bright=.5):
    N=int(sr/f); buf=rng.uniform(-1,1,N); n=int(dur*sr); y=np.zeros(n)
    for k in range(n):
        y[k]=buf[k%N]; buf[k%N]=.5*(buf[k%N]+buf[(k+1)%N])*(.996 if bright>0 else .99)
    env=np.minimum(1,np.arange(n)/40); return amp*y*env
def bell(f,dur=.8,amp=.12):
    t=np.arange(int(dur*sr))/sr
    y=np.sin(2*np.pi*f*t)+.35*np.sin(2*np.pi*f*2.76*t)*np.exp(-t*9)+.2*np.sin(2*np.pi*f*5.4*t)*np.exp(-t*14)
    return amp*y*np.exp(-t*4.5)*np.minimum(1,t/.003)
def bass(f,dur,amp=.22):
    t=np.arange(int(dur*sr))/sr
    y=np.sin(2*np.pi*f*t)+.3*np.sin(2*np.pi*2*f*t)
    return amp*y*np.exp(-t*3)*np.minimum(1,t/.005)
def kick():
    t=np.arange(int(.25*sr))/sr; f=50+90*np.exp(-t*30)
    return .5*np.sin(2*np.pi*np.cumsum(f)/sr)*np.exp(-t*14)
def noise_hit(dur,amp,lo,hi,decay):
    n=int(dur*sr); x=rng.uniform(-1,1,n)
    X=np.fft.rfft(x); fr=np.fft.rfftfreq(n,1/sr); X[(fr<lo)|(fr>hi)]=0; x=np.fft.irfft(X,n)
    x/=np.abs(x).max()+1e-9; t=np.arange(n)/sr; return amp*x*np.exp(-t*decay)
def clap():
    c=np.zeros(int(.2*sr))
    for d in (0,.011,.022): s=noise_hit(.17,.22,900,4000,28); i=int(d*sr); c[i:i+len(s)]+=s[:len(c)-i]
    return c
def shaker(): return noise_hit(.06,.07,5000,12000,70)

prog=[("F",41,[65,69,72]),("C",48,[64,67,72]),("Dm",50,[62,65,69]),("Bb",46,[62,65,70])]
mel=[
 [72,72,74,72,69,67,65,67],[69,0,67,0,64,65,67,0],[69,69,70,72,74,72,70,69],[70,69,67,65,67,0,0,0],
 [77,0,76,74,72,74,76,77],[79,77,76,74,72,0,0,0],[74,76,77,74,72,70,69,70],[72,0,69,0,67,65,67,69],
 [72,74,76,77,76,74,72,69],[67,69,70,72,74,0,72,0],[74,72,70,69,70,72,74,76],[77,0,0,0,72,0,77,0],
 [77,0,76,74,72,74,76,77],[79,77,76,74,72,0,74,0],[74,76,77,74,72,70,69,67],[65,0,0,0,0,0,0,0]
]
for b in range(bars):
    name,root,ch=prog[b%4]; t0=b*4*beat
    for q in range(4):
        tq=t0+q*beat
        if q in (0,2): add(kick(),tq)
        if q in (1,3): add(clap(),tq)
        for h in range(2): add(shaker()*(1.0 if h else .6),tq+h*e8)
        # bouncy bass: root on beat, octave on the "and"
        add(bass(mf(root),e8*.9),tq); add(bass(mf(root+12),e8*.7,.12),tq+e8)
        # ukulele-ish strum on off-beats
        for k,m in enumerate(ch): add(pluck(mf(m),.45,.09),tq+e8+k*.012)
    for i,m in enumerate(mel[b]):
        if m: add(bell(mf(m+12) if b>=12 else mf(m), .9, .11), t0+i*e8)
# wrap the tail into the start for a seamless loop
tail=out[L:]; out=out[:L]; out[:len(tail)]+=tail
# gentle room
ir=np.zeros(int(.35*sr)); 
for d,a in [(.031,.25),(.053,.18),(.089,.12),(.137,.08),(.211,.05),(.31,.03)]: ir[int(d*sr)]=a
wet=np.fft.irfft(np.fft.rfft(out,len(out)+len(ir))*np.fft.rfft(ir,len(out)+len(ir)))
wtail=wet[L:]; wet=wet[:L]; wet[:len(wtail)]+=wtail
mix=out+.6*wet
mix/=np.abs(mix).max()/0.8
sf.write("bgm.wav",mix.astype(np.float32),sr)
print("loop seconds",L/sr)
