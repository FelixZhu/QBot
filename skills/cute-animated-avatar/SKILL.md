---
name: Cute animated avatar
description: >-
  Use this when the user wants a new (animated) profile picture for this bot or
  other bots: designs a plush-style character, generates it, and turns it into a
  circle-friendly looping GIF with blinks and a signature motion.
---
# Cute animated avatar (plush GIF)

Makes a soft 3D plush-style character avatar that loops as a GIF: an occasional blink plus one signature motion, framed for circular display. Every bot in the family gets its own motion and blink rhythm.

## 1. Design and confirm
- Pick an animal or character that fits the bot's role and add one prop (paper plane for messaging, newspaper for news, paintbrush for creative work). If the user gives a reference image, follow its character.
- For a family of bots, give each one a **different** motion (`sway` / `hop` / `tilt` / `groove`), loop length (4–12 s), and blink style (fast or slow, a double blink, or a one-eye wink). Before building a set of several, write up the plan and get the user's OK.

## 2. Generate the still
GenerateImage at 1:1, with the earlier avatars passed as `reference_image_paths` so the style stays consistent. Prompt pattern:
"Avatar portrait in soft fluffy 3D plush style: <character>, big round glossy dark eyes with white highlights, <prop>. Front-facing head and upper body, centered, filling about 80% of the frame, plain warm cream background. Eyes OPEN. No text."
The output is usually 1280×720, even when you ask for 1:1. Check the real size with PIL before measuring anything.

## 3. Measure the eyes
Read the image, estimate each eye's center and radius in **real source pixels** (displayed coords × width/1024 if the viewer showed 1024 wide), and write a config JSON (fields documented in the script header). Use `crop_w` greater than 720 only when a prop at the side would otherwise be cut off.

## 4. Build and check
Save the script below as `animate_avatar.py` (e.g. under /workspace/avatars) and run `python3 animate_avatar.py cfg.json`. Read the `_preview.png` it writes: the first frame plus each blink frame, masked to a circle.
- If an eyelid sits off the eye, the coordinates are wrong (usually a scale mistake).
- If the closed lid looks like a dark disk, raise `lid_up` or enlarge `r`.
- If the ears are clipped by the circle, lower `scale`. If there's too much empty space on top, raise it (0.87 has been the preferred framing).
- Keep the GIF under about 2 MB (200 px, 96 colors, 10 fps). Larger files have failed to upload as avatars.

## 5. Apply
- For yourself, use UpdateAvatar (`set`, path to the GIF).
- Other bots: you can't set their picture. SendToAgent (priority true) asking them to run UpdateAvatar with the exact box path, then tell the user once they confirm.
- Show the user the GIFs in chat.

## Script
```python
#!/usr/bin/env python3
"""Animate a front-facing character portrait into a looping circle-friendly avatar GIF.
Usage: python3 animate_avatar.py config.json
Config keys (all pixel values are in the SOURCE image's real pixels; check size with PIL first):
  src         path to source image (plain solid background, character centered, body runs off bottom edge)
  out         output .gif path
  eyes        [[x,y],[x,y]] eye centers
  r           eye radius (covers iris + white)
  crop_w      width of the centered crop (>= image height; widen to keep props like a held item)
  scale       0.87 typical: character size inside frame (bigger = less top whitespace)
  lid_up      px above the eye top to sample eyelid fur color (raise if lid looks like a dark disk)
  motion      one of: sway, hop, tilt, groove
  loop_s      loop length in seconds (blink period)
  blinks      list of [frame_index, "both"|"left"|"right", "fast"|"slow"]  (10 fps, so frame = seconds*10)
  amp         optional motion strength multiplier (default 1)
  size        output px (default 200)
"""
import json,math,sys
from PIL import Image,ImageDraw,ImageFilter,ImageChops
C=json.load(open(sys.argv[1]))
src=Image.open(C['src']).convert('RGB'); w,h=src.size
W=max(h,C.get('crop_w',h)); l=(w-W)//2; bg=src.getpixel((5,5))
base=Image.new('RGB',(W,W),bg); base.paste(src.crop((max(0,l),0,min(w,l+W),h)),(max(0,-l),W-h)); oy=W-h
eyes=[(x-l,y+oy) for x,y in C['eyes']]; r=C['r']; kf=C.get('scale',0.87); amp=C.get('amp',1.0)
def fur(x,y):
    px=[base.getpixel((x+a,y+b)) for a in range(-4,5) for b in range(-4,5)]
    return tuple(sum(c[k] for c in px)//len(px) for k in range(3))
cols=[fur(ex,ey-r-C.get('lid_up',18)) for ex,ey in eyes]
EXT=int(W*0.25)
def extend(img):  # stretch bottom rows downward so hops/tilts never reveal a cut edge
    e=Image.new('RGB',(W,W+EXT),bg); e.paste(img,(0,0))
    e.paste(img.crop((0,W-30,W,W)).resize((W,EXT),Image.BICUBIC).filter(ImageFilter.GaussianBlur(2)),(0,W)); return e
def blink(img,ts):
    if max(ts)<=0: return img
    im=img.copy(); m=Image.new('L',im.size,0); d=ImageDraw.Draw(m)
    lid=Image.new('RGB',im.size,0); dl=ImageDraw.Draw(lid); em=Image.new('L',im.size,0); de=ImageDraw.Draw(em)
    for (ex,ey),c,t in zip(eyes,cols,ts):
        if t<=0: continue
        d.rectangle([ex-r-6,ey-r-8,ex+r+6,ey-r+2*r*t+2],fill=255)
        dl.rectangle([ex-r-8,ey-r-12,ex+r+8,ey+r+8],fill=c)
        de.ellipse([ex-r-3,ey-r-3,ex+r+3,ey+r+3],fill=255)
    im.paste(lid,(0,0),ImageChops.multiply(m,em).filter(ImageFilter.GaussianBlur(3)))
    dd=ImageDraw.Draw(im)
    for (ex,ey),t in zip(eyes,ts):
        if t>0.85: y=ey+r; dd.arc([ex-r*0.8,y-r*0.6,ex+r*0.8,y+r*0.15],20,160,fill=(45,25,15),width=max(4,int(r*0.1)))
    return im
N=int(C.get('loop_s',8)*10)
def blink_vals(i):
    v=[0,0]
    for fi,which,speed in C.get('blinks',[]):
        curve={0:1,1:0.5} if speed=='fast' else {0:1,1:0.85,2:0.6,3:0.3}
        b=curve.get(abs(i-fi),0)
        if which in('both','left'): v[0]=max(v[0],b)
        if which in('both','right'): v[1]=max(v[1],b)
    return v
def motion(i):
    t=i/N; sec=i/10; ang=dx=dy=0; sx=sy=1; m=C['motion']
    if m=='sway':   # lazy side-to-side, 4s period
        ang=3*math.sin(2*math.pi*sec/4); dy=2*math.sin(2*math.pi*sec/2)
    elif m=='hop':  # 1s hops with squash on landing
        p=sec%1; dy=-40*max(0,math.sin(2*math.pi*p))
        if p>0.5: q=math.sin(2*math.pi*(p-0.5)); sy=1-0.08*q; sx=1+0.06*q
    elif m=='tilt': # curious head tilt and hold, one each way per loop
        def tl(a,b):
            if not a<=t<=b: return 0
            u=(t-a)/(b-a)
            return math.sin(math.pi/2*u/0.25) if u<0.25 else (1 if u<0.75 else math.cos(math.pi/2*(u-0.75)/0.25))
        ang=9*tl(0.17,0.42)-8*tl(0.62,0.83)
    elif m=='groove': # rhythmic rock + one excited hop near the end
        ang=4*math.sin(2*math.pi*sec/1.5); dx=6*math.sin(2*math.pi*sec/1.5)
        if 0.70<t<0.82: dy=-35*math.sin(math.pi*(t-0.70)/0.12)
    return ang*amp,dx*amp,dy*amp,1+(sx-1)*amp,1+(sy-1)*amp
s=W; k=int(s*kf); fr=[]
for i in range(N):
    ang,dx,dy,sx,sy=motion(i)
    f=extend(blink(base,blink_vals(i))).rotate(ang,resample=Image.BICUBIC,center=(s/2,s),fillcolor=bg)
    kw,kh=int(k*sx),int((s+EXT)*k/s*sy); sm=f.resize((kw,kh),Image.LANCZOS)
    c=Image.new('RGB',(s,s),bg); c.paste(sm,((s-kw)//2+int(dx*s/576),s-int(k*sy)+6+int(dy*s/576)))
    fr.append(c.resize((C.get('size',200),)*2,Image.LANCZOS))
pal=fr[N//2].quantize(colors=96,method=Image.MEDIANCUT)
q=[f.quantize(palette=pal,dither=Image.FLOYDSTEINBERG) for f in fr]
q[0].save(C['out'],save_all=True,append_images=q[1:],duration=100,loop=0,optimize=True)
# preview sheet: first frame + every blink frame, circle-masked
S=C.get('size',200); idx=[0]+[b[0] for b in C.get('blinks',[])]
pv=Image.new('RGB',(S*len(idx),S),(40,40,40)); mk=Image.new('L',(S,S),0); ImageDraw.Draw(mk).ellipse([0,0,S-1,S-1],fill=255)
for j,i in enumerate(idx): pv.paste(fr[min(i,N-1)],(j*S,0),mk)
pv.save(C['out'].rsplit('.',1)[0]+'_preview.png'); print('ok',C['out'],N,'frames')
```
