
from PIL import Image
from pathlib import Path
src = Path(r'E:\dsh\写作副驾\resources\icons\icon.png')
out = Path(r'E:\dsh\写作副驾\resources\icons\icon.ico')
im = Image.open(src).convert('RGBA')
w,h = im.size
side = min(w,h)
im = im.crop(((w-side)//2, (h-side)//2, (w-side)//2+side, (h-side)//2+side))
sizes = [16,24,32,48,64,128,256]
imgs = [im.resize((s,s), Image.Resampling.LANCZOS) for s in sizes]
# ICO: save largest first with sizes list
imgs[-1].save(out, format='ICO', sizes=[(s,s) for s in sizes])
print('ico_size', out.stat().st_size)
print('png_src', src.stat().st_size, im.size)
