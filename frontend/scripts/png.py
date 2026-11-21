"""Optimiza las capturas sin bajar resolución: PNG de paleta (256 colores), sin tramado para que el texto quede nítido.
   python scripts/png.py <carpeta>   (requiere Pillow)

La paleta es la de MEDIANCUT (degradados suaves, sin bandas) más los colores fijos del tema: MEDIANCUT reparte
los colores según cuántos píxeles ocupan y, sin ellos, el naranja de aviso de un punto pequeño salía beige.
"""
import sys
from pathlib import Path

from PIL import Image

# Acentos, estados y fondos de frontend/src/styles.css.
TEMA = ["#56d4ff", "#8f7dff", "#4ade9a", "#ffb454", "#ff8278", "#7aa8ff", "#74a8ff", "#e9eef8",
        "#93a1b8", "#060913", "#0d1220", "#ffffff", "#0b1020", "#2b3a55", "#1a2233", "#3a4560"]


def cuantiza(img: Image.Image) -> Image.Image:
    n = 256 - len(TEMA)
    colores = img.quantize(n, method=Image.Quantize.MEDIANCUT).getpalette()[: n * 3]
    for h in TEMA:
        colores += [int(h[i:i + 2], 16) for i in (1, 3, 5)]
    paleta = Image.new("P", (1, 1))
    paleta.putpalette(colores)
    return img.quantize(palette=paleta, dither=Image.Dither.NONE)


if __name__ == "__main__":
    for p in sorted(Path(sys.argv[1]).glob("*.png")):
        antes = p.stat().st_size
        cuantiza(Image.open(p).convert("RGB")).save(p, optimize=True)
        print(f"{p.name}: {antes // 1024} KB -> {p.stat().st_size // 1024} KB")
