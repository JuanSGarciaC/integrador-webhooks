"""Une los fotogramas de frames.mjs en un GIF a ritmo real:
   python scripts/gif.py <carpeta> <salida.gif> [ancho=1080]   (requiere Pillow)

Los fotogramas se llaman <milisegundos>.png. Se remuestrean a 12,5 fps manteniendo el último fotograma en los
huecos (el screencast solo emite cuando algo cambia). Una sola paleta para todo el GIF, como palettegen de ffmpeg:
sin parpadeo entre fotogramas y Pillow guarda solo la zona que cambia.
"""
import sys
from pathlib import Path

from PIL import Image

from png import TEMA

PASO_MS = 80  # 12,5 fps

src, out = Path(sys.argv[1]), sys.argv[2]
ancho = int(sys.argv[3]) if len(sys.argv) > 3 else 1080
archivos = sorted(src.glob("*.png"), key=lambda p: int(p.stem))
assert archivos, f"no hay fotogramas en {src}"
horas = [int(p.stem) for p in archivos]

# Remuestreo: en cada instante, el último fotograma emitido hasta entonces.
indices, t, i = [], horas[0], 0
while t <= horas[-1] + 1000:  # 1 s final quieto
    while i + 1 < len(horas) and horas[i + 1] <= t:
        i += 1
    indices.append(i)
    t += PASO_MS

cache: dict[int, Image.Image] = {}
def fotograma(k: int) -> Image.Image:
    if k not in cache:
        img = Image.open(archivos[k]).convert("RGB")
        cache[k] = img.resize((ancho, round(img.height * ancho / img.width)), Image.LANCZOS)
    return cache[k]

# Paleta global: MEDIANCUT sobre un mosaico de fotogramas repartidos por toda la grabación + colores del tema.
muestra = [fotograma(indices[j]) for j in range(0, len(indices), max(1, len(indices) // 12))]
mosaico = Image.new("RGB", (ancho, sum(f.height for f in muestra)))
y = 0
for f in muestra:
    mosaico.paste(f, (0, y))
    y += f.height
n = 256 - len(TEMA)
colores = mosaico.quantize(n, method=Image.Quantize.MEDIANCUT).getpalette()[: n * 3]
for h in TEMA:
    colores += [int(h[k:k + 2], 16) for k in (1, 3, 5)]
paleta = Image.new("P", (1, 1))
paleta.putpalette(colores)

# Fotogramas idénticos seguidos se unen en uno más largo.
salida, duraciones = [], []
for k in indices:
    if salida and k == salida[-1][0]:
        duraciones[-1] += PASO_MS
    else:
        salida.append((k, fotograma(k).quantize(palette=paleta, dither=Image.Dither.NONE)))
        duraciones.append(PASO_MS)
imgs = [q for _, q in salida]
imgs[0].save(out, save_all=True, append_images=imgs[1:], duration=duraciones, loop=0, optimize=True, disposal=1)
total = sum(duraciones) / 1000
print(f"{len(indices)} pasos de {PASO_MS} ms ({total:.1f} s), {len(imgs)} fotogramas distintos, "
      f"{Path(out).stat().st_size // 1024} KB")
