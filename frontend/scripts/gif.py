"""Une los fotogramas de frames.mjs en un GIF: uv run --with pillow scripts/gif.py <carpeta> <salida.gif>"""
import sys
from pathlib import Path

from PIL import Image

src, out = Path(sys.argv[1]), sys.argv[2]
frames = [Image.open(p).convert("RGB") for p in sorted(src.glob("*.png"))]
assert frames, f"no hay fotogramas en {src}"
frames = [f.resize((800, round(f.height * 800 / f.width)), Image.LANCZOS) for f in frames]
# Paleta común tomada de inicio, mitad y final: sin ella cada fotograma trae la suya y el archivo se dispara.
strip = Image.new("RGB", (800, frames[0].height * 3))
for i, f in enumerate((frames[0], frames[len(frames) // 2], frames[-1])):
    strip.paste(f, (0, i * f.height))
palette = strip.quantize(64, dither=Image.Dither.NONE)
quantized = [f.quantize(palette=palette, dither=Image.Dither.NONE) for f in frames]
quantized[0].save(out, save_all=True, append_images=quantized[1:], duration=100, loop=0, optimize=True)
print(len(frames), "fotogramas,", Path(out).stat().st_size // 1024, "KB")
