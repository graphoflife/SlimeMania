# App icons (PNG) from the 16x16 pixel slime in favicon.svg, scaled up with sharp pixels on
# the game's dark background. Phones need PNGs to install the game as an app.
#
#   python3 tools/icons.py
import os, re
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
BG = (0x14, 0x0f, 0x24)
# file: (size, pixel scale of the 16x16 slime). Maskable icons get cut to a circle or a rounded
# square by the phone, so the slime stays within the middle 80 %.
ICONS = {
    'icon-192.png': (192, 10),
    'icon-512.png': (512, 26),
    'icon-maskable-512.png': (512, 20),
    'icon-180.png': (180, 9),  # iPhone home screen
}


def polygons(d):
    """The subpaths of an SVG path made only of M, h, v, H, V and z."""
    out, x, y = [], 0, 0
    for cmd, num in re.findall(r'([MmHhVvZz])([^MmHhVvZz]*)', d):
        n = [float(v) for v in re.findall(r'-?[\d.]+', num)]
        if cmd == 'M': x, y = n; out.append([(x, y)])
        elif cmd == 'h': x += n[0]
        elif cmd == 'H': x = n[0]
        elif cmd == 'v': y += n[0]
        elif cmd == 'V': y = n[0]
        if cmd in 'hHvV': out[-1].append((x, y))
    return out


def inside(poly, px, py):
    c = False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > py) != (y2 > py) and px < x1 + (py - y1) * (x2 - x1) / (y2 - y1):
            c = not c
    return c


def slime():
    svg = open(os.path.join(ROOT, 'favicon.svg')).read()
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for fill, d in re.findall(r'<path fill="#([0-9a-f]{3}|[0-9a-f]{6})" d="([^"]+)"', svg):
        if len(fill) == 3: fill = ''.join(c * 2 for c in fill)
        col = tuple(int(fill[i:i + 2], 16) for i in (0, 2, 4)) + (255,)
        for poly in polygons(d):
            for y in range(16):
                for x in range(16):
                    if inside(poly, x + 0.5, y + 0.5):
                        img.putpixel((x, y), col)
    return img


src = slime()
os.makedirs(os.path.join(ROOT, 'icons'), exist_ok=True)
for name, (size, k) in ICONS.items():
    out = Image.new('RGB', (size, size), BG)
    big = src.resize((16 * k, 16 * k), Image.NEAREST)
    o = (size - 16 * k) // 2
    out.paste(big, (o, o), big)
    out.save(os.path.join(ROOT, 'icons', name), optimize=True)
    print('wrote icons/' + name)
