"""Genera los recursos livianos que utiliza el sitio público.

Los archivos fuente se conservan como originales editables. Ejecutar desde la
raíz del proyecto con: python scripts/optimize-web-images.py
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageSequence


ROOT = Path(__file__).resolve().parents[1]
LANCZOS = Image.Resampling.LANCZOS


# origen, salida, ancho máximo, calidad WebP
WEBP_IMAGES = [
    ("assets/hero.png", "assets/hero-web.webp", 1920, 80),
    ("assets/img/mapa-araucania-web.png", "assets/img/mapa-araucania-web.webp", 1536, 86),
    ("assets/img/letreros/voluntariado.png", "assets/img/letreros/voluntariado-web.webp", 900, 88),
    ("assets/img/letreros/productos.png", "assets/img/letreros/productos-web.webp", 900, 88),
    ("assets/img/letreros/servicios.png", "assets/img/letreros/servicios-web.webp", 900, 88),
    ("assets/img/marcos/ventana-rustica-transparente.png", "assets/img/marcos/ventana-rustica-transparente-web.webp", 1280, 86),
    ("assets/img/voluntariado/nana-preguntas-web.png", "assets/img/voluntariado/nana-preguntas-web.webp", 720, 88),
]

for filename in (
    "cosecha-comunitaria-06",
    "paisaje-territorio-02",
    "encuentro-comunitario-01",
    "vida-rural-animales-04",
    "trabajo-agricola-03",
    "trabajo-en-la-huerta-05",
    "gallina-del-territorio-07",
):
    WEBP_IMAGES.append(
        (f"assets/img/carrusel/{filename}.png", f"assets/img/carrusel/{filename}-web.webp", 1440, 80)
    )

for filename in (
    "diseño_web",
    "servicios_iot",
    "chipeadora",
    "motocultivador",
    "diseño_agroecologico",
    "taller_agroecologia",
    "taller_permacultura",
    "cosmovision_lengua_mapuche",
):
    WEBP_IMAGES.append(
        (
            f"assets/img/carrusel_servicios/{filename}.png",
            f"assets/img/carrusel_servicios/{filename}-web.webp",
            1200,
            80,
        )
    )


ANIMATED_ICONS = (
    "voluntariado",
    "productos",
    "servicios",
)


def resized(image: Image.Image, max_width: int) -> Image.Image:
    if image.width <= max_width:
        return image.copy()
    target_height = round(image.height * max_width / image.width)
    return image.resize((max_width, target_height), LANCZOS)


def is_current(source: Path, output: Path) -> bool:
    return output.exists() and output.stat().st_size > 0 and output.stat().st_mtime >= source.stat().st_mtime


def save_static_webp(source_name: str, output_name: str, max_width: int, quality: int) -> tuple[int, int]:
    source = ROOT / source_name
    output = ROOT / output_name
    output.parent.mkdir(parents=True, exist_ok=True)

    if is_current(source, output):
        return source.stat().st_size, output.stat().st_size

    with Image.open(source) as original:
        image = resized(original, max_width)
        if "A" in image.getbands():
            image = image.convert("RGBA")
        else:
            image = image.convert("RGB")
        image.save(output, "WEBP", quality=quality, method=6, exact=True)

    return source.stat().st_size, output.stat().st_size


def save_logo() -> tuple[int, int]:
    source = ROOT / "assets/img/logo.png"
    output = ROOT / "assets/img/logo-web.png"
    if is_current(source, output):
        return source.stat().st_size, output.stat().st_size
    with Image.open(source) as original:
        logo = resized(original.convert("RGBA"), 1024)
        logo.save(output, "PNG", optimize=True, compress_level=9)
    return source.stat().st_size, output.stat().st_size


def save_animated_icon(name: str) -> tuple[int, int]:
    source = ROOT / f"assets/icons/{name}.gif"
    output = ROOT / f"assets/icons/{name}-web.webp"

    if is_current(source, output):
        return source.stat().st_size, output.stat().st_size

    with Image.open(source) as animation:
        frames: list[Image.Image] = []
        durations: list[int] = []
        for frame in ImageSequence.Iterator(animation):
            prepared = frame.convert("RGBA").resize((160, 160), LANCZOS)
            frames.append(prepared)
            durations.append(int(frame.info.get("duration", animation.info.get("duration", 80))))

        frames[0].save(
            output,
            "WEBP",
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=int(animation.info.get("loop", 0)),
            quality=72,
            method=4,
            allow_mixed=True,
        )

    return source.stat().st_size, output.stat().st_size


def human_size(size: int) -> str:
    return f"{size / 1024:.0f} KB"


def main() -> None:
    results: list[tuple[str, int, int]] = []

    before, after = save_logo()
    results.append(("assets/img/logo-web.png", before, after))

    for source, output, max_width, quality in WEBP_IMAGES:
        before, after = save_static_webp(source, output, max_width, quality)
        results.append((output, before, after))

    for name in ANIMATED_ICONS:
        before, after = save_animated_icon(name)
        results.append((f"assets/icons/{name}-web.webp", before, after))

    total_before = sum(before for _, before, _ in results)
    total_after = sum(after for _, _, after in results)
    for name, before, after in results:
        reduction = 100 * (1 - after / before)
        print(f"{name}: {human_size(before)} -> {human_size(after)} ({reduction:.1f}% menos)")
    print(f"TOTAL: {human_size(total_before)} -> {human_size(total_after)} ({100 * (1 - total_after / total_before):.1f}% menos)")


if __name__ == "__main__":
    main()
