#!/usr/bin/env python3
"""
Génère l'avatar « Claire » (public/avatars/claire.vrm) à partir du modèle d'exemple de pixiv
(public/avatars/default.vrm, licence VRM 1.0 : modification et redistribution autorisées,
usage commercial autorisé).

Claire : femme d'une trentaine d'années, environ 1,70 m, cheveux blonds, yeux bleu-gris, chemise noire
à manches longues avec le logo Orange à droite (vu de face), pantalon noir.

- cheveux et sourcils recolorés en blond (le relief des mèches est conservé) ;
- chemise : le t-shirt d'origine devient noir (plis conservés, texture doublée pour un logo net),
  avec col, patte de boutonnage et boutons projetés sur le maillage (ils suivent la courbure du
  buste), et des manches longues (bras « habillés » jusqu'aux poignets, avec revers) ;
- pantalon d'un seul tenant : le short est retiré, jambes et bassin sont habillés (texture peinte
  d'après les os, volume du tissu en coupe droite) ;
- silhouette adulte : jambes, buste et bras allongés, tête un peu plus petite, yeux moins grands ;
  le squelette, les matrices de liaison, les ressorts des cheveux et le regard suivent.

Usage : python3 scripts/build-claire.py   (nécessite Python 3, numpy et Pillow)
"""
import io
import json
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'public' / 'avatars' / 'default.vrm'
OUT = ROOT / 'public' / 'avatars' / 'claire.vrm'

ORANGE = (255, 121, 0)  # orange de la marque (#FF7900)
# Teinte des manches longues (peintes sur la peau) : plus claire que le tissu de la chemise car le
# matériau de la peau s'éclaire moins ; mesurée sur un rendu pour que les deux se confondent.
SHIRT = (46, 46, 55)
LOGO_SIZE = 0.046  # côté du logo, en mètres
# Côté du logo : +1 = à droite vu de face (côté cœur de la personne), -1 = de l'autre côté.
LOGO_SIDE = 1


# ----------------------------------------------------------------------------- GLB


class Glb:
    def __init__(self, path):
        data = path.read_bytes()
        json_len = struct.unpack('<I', data[12:16])[0]
        self.json = json.loads(data[20 : 20 + json_len])
        bin_start = 20 + json_len + 8
        bin_len = struct.unpack('<I', data[20 + json_len : 24 + json_len])[0]
        self.bin = bytearray(data[bin_start : bin_start + bin_len])
        self.replaced = {}  # bufferView -> nouvelles données

    def view_bytes(self, index):
        if index in self.replaced:
            return self.replaced[index]
        bv = self.json['bufferViews'][index]
        start = bv.get('byteOffset', 0)
        return bytes(self.bin[start : start + bv['byteLength']])

    def _read(self, bv_index, offset, component, comps, count):
        bv = self.json['bufferViews'][bv_index]
        dtype = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[component]
        start = bv.get('byteOffset', 0) + offset
        return np.frombuffer(self.bin, dtype=dtype, count=count * comps, offset=start).reshape(count, comps).copy()

    def accessor(self, index):
        acc = self.json['accessors'][index]
        if 'sparse' in acc or 'bufferView' not in acc:
            comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
            out = np.zeros((acc['count'], comps), np.float32) if 'bufferView' not in acc else self._dense(index)
            sp = acc.get('sparse')
            if sp:
                ids = self._read(sp['indices']['bufferView'], sp['indices'].get('byteOffset', 0), sp['indices']['componentType'], 1, sp['count'])[:, 0]
                out[ids] = self._read(sp['values']['bufferView'], sp['values'].get('byteOffset', 0), acc['componentType'], comps, sp['count'])
            return out if comps > 1 else out[:, 0]
        return self._dense(index)

    def _dense(self, index):
        acc = self.json['accessors'][index]
        bv = self.json['bufferViews'][acc['bufferView']]
        comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}[acc['type']]
        dtype = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}[acc['componentType']]
        start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        size = np.dtype(dtype).itemsize
        stride = bv.get('byteStride', 0) or comps * size
        count = acc['count']
        rows = [np.frombuffer(self.bin, dtype=dtype, count=comps, offset=start + r * stride) for r in range(count)] if stride != comps * size else None
        out = np.stack(rows) if rows is not None else np.frombuffer(self.bin, dtype=dtype, count=count * comps, offset=start).reshape(count, comps)
        return out.copy() if comps > 1 else out.reshape(count).copy()

    def write_accessor(self, index, values):
        acc = self.json['accessors'][index]
        if 'sparse' in acc:
            # seules les valeurs listées sont stockées (les autres restent nulles)
            sp = acc['sparse']
            assert 'bufferView' not in acc and acc['componentType'] == 5126
            ids = self._read(sp['indices']['bufferView'], sp['indices'].get('byteOffset', 0), sp['indices']['componentType'], 1, sp['count'])[:, 0]
            bv = self.json['bufferViews'][sp['values']['bufferView']]
            start = bv.get('byteOffset', 0) + sp['values'].get('byteOffset', 0)
            data = values[ids].astype(np.float32).tobytes()
            self.bin[start : start + len(data)] = data
            acc['min'] = values.min(axis=0).tolist()
            acc['max'] = values.max(axis=0).tolist()
            return
        bv = self.json['bufferViews'][acc['bufferView']]
        assert acc['componentType'] == 5126 and not bv.get('byteStride')
        start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
        data = values.astype(np.float32).tobytes()
        self.bin[start : start + len(data)] = data
        acc['min'] = values.min(axis=0).tolist()
        acc['max'] = values.max(axis=0).tolist()

    def image(self, name):
        for i, im in enumerate(self.json['images']):
            if im.get('name') == name:
                return i, Image.open(io.BytesIO(self.view_bytes(im['bufferView']))).convert('RGB')
        raise KeyError(name)

    def set_image(self, index, img):
        buf = io.BytesIO()
        img.save(buf, 'PNG', optimize=True)
        self.replaced[self.json['images'][index]['bufferView']] = buf.getvalue()
        self.json['images'][index]['mimeType'] = 'image/png'

    def save(self, path):
        out = bytearray()
        for i, bv in enumerate(self.json['bufferViews']):
            data = self.view_bytes(i)
            while len(out) % 4:
                out.append(0)
            bv['byteOffset'] = len(out)
            bv['byteLength'] = len(data)
            out += data
        while len(out) % 4:
            out.append(0)
        self.json['buffers'][0]['byteLength'] = len(out)
        js = json.dumps(self.json, ensure_ascii=False, separators=(',', ':')).encode()
        js += b' ' * (-len(js) % 4)
        total = 12 + 8 + len(js) + 8 + len(out)
        path.write_bytes(
            struct.pack('<III', 0x46546C67, 2, total) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + out
        )


# --------------------------------------------------------------------- géométrie


def quat_mat(q):
    x, y, z, w = q
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
        ]
    )


def world_positions(j):
    """Position de chaque nœud dans le repère du modèle."""
    nodes = j['nodes']
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    cache = {}

    def mat(i):
        if i in cache:
            return cache[i]
        n = nodes[i]
        m = np.eye(4)
        m[:3, :3] = quat_mat(n.get('rotation', [0, 0, 0, 1])) * np.array(n.get('scale', [1, 1, 1]))
        m[:3, 3] = n.get('translation', [0, 0, 0])
        if i in parent:
            m = mat(parent[i]) @ m
        cache[i] = m
        return m

    return {i: mat(i)[:3, 3] for i in range(len(nodes))}


def primitive(glb, mesh_name, material_name):
    j = glb.json
    for m in j['meshes']:
        if m['name'] != mesh_name:
            continue
        for p in m['primitives']:
            if j['materials'][p['material']]['name'] == material_name:
                a = p['attributes']
                return {
                    'pos': glb.accessor(a['POSITION']),
                    'pos_acc': a['POSITION'],
                    'nrm': glb.accessor(a['NORMAL']),
                    'uv': glb.accessor(a['TEXCOORD_0']),
                    'joints': glb.accessor(a['JOINTS_0']),
                    'weights': glb.accessor(a['WEIGHTS_0']),
                    'idx': glb.accessor(p['indices']).reshape(-1, 3),
                }
    raise KeyError(material_name)


def raycast_front(prim, x, y):
    """Point le plus en avant (+Z) du maillage à la verticale (x, y) : coordonnées UV."""
    p, t = prim['pos'], prim['idx']
    a, b, c = p[t[:, 0]], p[t[:, 1]], p[t[:, 2]]
    # barycentriques dans le plan XY
    v0, v1 = b[:, :2] - a[:, :2], c[:, :2] - a[:, :2]
    v2 = np.array([x, y]) - a[:, :2]
    den = v0[:, 0] * v1[:, 1] - v1[:, 0] * v0[:, 1]
    ok = np.abs(den) > 1e-12
    den = np.where(ok, den, 1)
    v = (v2[:, 0] * v1[:, 1] - v1[:, 0] * v2[:, 1]) / den
    w = (v0[:, 0] * v2[:, 1] - v2[:, 0] * v0[:, 1]) / den
    u = 1 - v - w
    inside = ok & (u >= -1e-6) & (v >= -1e-6) & (w >= -1e-6)
    if not inside.any():
        return None
    z = u * a[:, 2] + v * b[:, 2] + w * c[:, 2]
    k = np.where(inside, z, -np.inf).argmax()
    uv = prim['uv']
    tri = t[k]
    return u[k] * uv[tri[0]] + v[k] * uv[tri[1]] + w[k] * uv[tri[2]]


def raster_triangles(size, tris_uv, values=None):
    """Rasterise des triangles (UV) : masque, ou valeur interpolée par sommet."""
    W, H = size
    mask = np.zeros((H, W), bool)
    acc = None if values is None else np.zeros((H, W, values.shape[-1]), np.float32)
    for k, tri in enumerate(tris_uv):
        px = tri * [W, H]
        x0, y0 = np.floor(px.min(axis=0)).astype(int) - 1
        x1, y1 = np.ceil(px.max(axis=0)).astype(int) + 1
        x0, y0, x1, y1 = max(x0, 0), max(y0, 0), min(x1, W - 1), min(y1, H - 1)
        if x1 < x0 or y1 < y0:
            continue
        ys, xs = np.mgrid[y0 : y1 + 1, x0 : x1 + 1]
        P = np.stack([xs + 0.5, ys + 0.5], -1)
        a, b, c = px
        v0, v1, v2 = b - a, c - a, P - a
        den = v0[0] * v1[1] - v1[0] * v0[1]
        if abs(den) < 1e-9:
            continue
        v = (v2[..., 0] * v1[1] - v1[0] * v2[..., 1]) / den
        w = (v0[0] * v2[..., 1] - v2[..., 0] * v0[1]) / den
        u = 1 - v - w
        inside = (u >= -0.02) & (v >= -0.02) & (w >= -0.02)
        mask[y0 : y1 + 1, x0 : x1 + 1] |= inside
        if acc is not None:
            val = u[..., None] * values[k, 0] + v[..., None] * values[k, 1] + w[..., None] * values[k, 2]
            region = acc[y0 : y1 + 1, x0 : x1 + 1]
            region[inside] = val[inside]
    return mask if acc is None else (mask, acc)


# ------------------------------------------------------------------------ couleurs


def luminance(img):
    a = np.asarray(img, np.float32) / 255
    return a @ np.array([0.299, 0.587, 0.114], np.float32)


def normalize(l, lo_pct=1, hi_pct=99):
    lo, hi = np.percentile(l, lo_pct), np.percentile(l, hi_pct)
    return np.clip((l - lo) / max(hi - lo, 1e-4), 0, 1)


def gradient(t, stops):
    """Dégradé de couleurs : stops = [(position, (r, g, b)), ...]."""
    pos = np.array([s[0] for s in stops])
    cols = np.array([s[1] for s in stops], np.float32)
    out = np.stack([np.interp(t, pos, cols[:, k]) for k in range(3)], -1)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


BLONDE = [(0.0, (122, 84, 44)), (0.35, (196, 150, 86)), (0.7, (235, 203, 140)), (1.0, (252, 236, 190))]


def blonde(img):
    return gradient(normalize(luminance(img)), BLONDE)


def black_fabric(img, dark=(16, 16, 19), light=(58, 58, 66)):
    """Tissu noir : les plis de la texture d'origine (claire) deviennent des nuances de gris foncé."""
    t = normalize(luminance(img), 0.5, 99.5) ** 1.4
    return gradient(t, [(0, dark), (1, light)])


def eyes_blue(img):
    """Iris bleu-gris : on garde la luminosité et les reflets, on change la teinte."""
    a = np.asarray(img, np.float32) / 255
    l = a @ np.array([0.299, 0.587, 0.114], np.float32)
    sat = a.max(-1) - a.min(-1)
    tint = np.array([0.36, 0.56, 0.78], np.float32)  # bleu-gris
    col = np.clip(l[..., None] * tint / 0.55, 0, 1)
    k = np.clip(sat * 3, 0, 1)[..., None]  # seules les zones colorées (l'iris) changent
    return Image.fromarray((np.clip(col * k + a * (1 - k), 0, 1) * 255).astype(np.uint8))


def logo_image(px=1024):
    """Logo Orange : carré orange, mot « orange » en blanc en bas à gauche, ™."""
    img = Image.new('RGB', (px, px), ORANGE)
    d = ImageDraw.Draw(img)
    font_path = '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
    size = int(px * 0.215)
    font = ImageFont.truetype(font_path, size)
    text = 'orange'
    # largeur cible : ~84 % du carré, comme sur le logo officiel
    while d.textlength(text, font=font) < px * 0.84:
        size += 2
        font = ImageFont.truetype(font_path, size)
    while d.textlength(text, font=font) > px * 0.84:
        size -= 1
        font = ImageFont.truetype(font_path, size)
    x = px * 0.055
    bbox = d.textbbox((0, 0), text, font=font)  # base de « orange » (sans le jambage du g) à ~92 %
    xh = d.textbbox((0, 0), 'o', font=font)
    baseline = px * 0.918
    d.text((x, baseline - xh[3]), text, font=font, fill='white')
    tm = ImageFont.truetype(font_path, int(px * 0.075))
    d.text((px * 0.865, px * 0.72), '™', font=tm, fill='white')
    return img


# ------------------------------------------------------------- décors du vêtement


def logo_rgba():
    img = np.asarray(logo_image(), np.float32)
    return np.concatenate([img, np.full(img.shape[:2] + (1,), 255, np.float32)], -1)


def project_decal(img, prim, cx, cy, w, h, rgba, n=16, soft=0.0):
    """Plaque une image (RGBA) sur la texture : chaque point d'une grille, vu de face, est projeté
    sur le maillage du vêtement ; l'image suit ainsi la courbure du corps."""
    grid = np.full((n + 1, n + 1, 2), np.nan)
    for gy in range(n + 1):
        for gx in range(n + 1):
            uv = raycast_front(prim, cx + (gx / n - 0.5) * w, cy + (0.5 - gy / n) * h)
            if uv is not None:
                grid[gy, gx] = uv
    tris, vals = [], []
    for gy in range(n):
        for gx in range(n):
            q = [(gy, gx), (gy, gx + 1), (gy + 1, gx + 1), (gy + 1, gx)]
            if any(np.isnan(grid[a, b]).any() for a, b in q):
                continue  # hors du vêtement (encolure…)
            uvq = [grid[a, b] for a, b in q]
            stq = [(b / n, a / n) for a, b in q]
            for tri in ((0, 1, 2), (0, 2, 3)):
                tris.append(np.array([uvq[k] for k in tri]))
                vals.append(np.array([stq[k] for k in tri]))
    mask, st = raster_triangles(img.size, np.array(tris), np.array(vals, np.float32))
    a = np.asarray(img, np.float32).copy()
    ys, xs = np.nonzero(mask)
    H_, W_ = rgba.shape[:2]
    s = np.clip(st[ys, xs, 0] * (W_ - 1), 0, W_ - 1)
    t = np.clip(st[ys, xs, 1] * (H_ - 1), 0, H_ - 1)
    s0, t0 = np.floor(s).astype(int), np.floor(t).astype(int)
    s1, t1 = np.minimum(s0 + 1, W_ - 1), np.minimum(t0 + 1, H_ - 1)
    fs, ft = (s - s0)[:, None], (t - t0)[:, None]
    col = (rgba[t0, s0] * (1 - fs) + rgba[t0, s1] * fs) * (1 - ft) + (rgba[t1, s0] * (1 - fs) + rgba[t1, s1] * fs) * ft
    alpha = col[:, 3:] / 255
    if soft:  # bord sans crénelage
        edge = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(soft)), np.float32) / 255
        alpha = alpha * np.minimum(1, edge[ys, xs][:, None] * 2)
    # imprimé sur le tissu : légère trace des plis
    fold = (luminance(img)[ys, xs] - 0.12)[:, None]
    a[ys, xs] = a[ys, xs] * (1 - alpha) + np.clip(col[:, :3] * (0.94 + fold * 0.4), 0, 255) * alpha
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


def paint_shirt_front(img, prim, neck_front, neck_side, hem_y):
    """Devant de chemise : col à deux pointes, patte de boutonnage et boutons."""
    w, top_y, bottom_y = 0.26, neck_front + 0.03, hem_y - 0.005
    h = top_y - bottom_y
    ppm = 4000  # pixels par mètre
    W_, H_ = int(w * ppm), int(h * ppm)
    dec = Image.new('RGBA', (W_, H_), (0, 0, 0, 0))
    d = ImageDraw.Draw(dec)

    def px(x, y):
        return ((x + w / 2) * ppm, (top_y - y) * ppm)

    nf, ns = neck_front, neck_side
    # patte de boutonnage
    d.rectangle([px(-0.011, nf - 0.04), px(0.011, bottom_y)], fill=(34, 34, 40, 255))
    for xe in (-0.011, 0.011):
        d.line([px(xe, nf - 0.04), px(xe, bottom_y)], fill=(64, 64, 74, 255), width=3)
    # col : deux pointes posées sur la poitrine
    for sgn in (-1, 1):
        flap = [(sgn * 0.004, nf + 0.006), (sgn * 0.056, ns + 0.008), (sgn * 0.1, ns - 0.042), (sgn * 0.036, nf - 0.082), (sgn * 0.004, nf - 0.05)]
        # pied de col : recouvre l'encolure ronde d'origine
        d.polygon([px(sgn * 0.0, nf + 0.03), px(sgn * 0.075, ns + 0.03), px(*flap[1]), px(*flap[0])], fill=(26, 26, 31, 255))
        d.polygon([px(*q) for q in flap], fill=(22, 22, 26, 255), outline=(84, 84, 98, 255), width=4)
        d.line([px(*flap[0]), px(*flap[1])], fill=(8, 8, 10, 255), width=6)  # pli du col contre le cou
        d.line([px(sgn * 0.03, nf - 0.07), px(sgn * 0.085, ns - 0.036)], fill=(30, 30, 35, 255), width=3)  # surpiqûre
    # boutons
    y_b = nf - 0.062
    while y_b > bottom_y + 0.02:
        cx_, cy_ = px(0, y_b)
        r = 0.0056 * ppm
        d.ellipse([cx_ - r, cy_ - r, cx_ + r, cy_ + r], fill=(48, 48, 56, 255), outline=(104, 104, 120, 255), width=3)
        for dx_, dy_ in ((-0.3, -0.3), (0.3, -0.3), (-0.3, 0.3), (0.3, 0.3)):
            hx, hy, hr = cx_ + dx_ * r, cy_ + dy_ * r, r * 0.13
            d.ellipse([hx - hr, hy - hr, hx + hr, hy + hr], fill=(18, 18, 22, 255))
        y_b -= 0.078
    return project_decal(img, prim, 0.0, (top_y + bottom_y) / 2, w, h, np.asarray(dec, np.float32), n=48)


def remove_primitive(glb, mesh_name, material_name):
    j = glb.json
    for m in j['meshes']:
        if m['name'] == mesh_name:
            m['primitives'] = [p for p in m['primitives'] if j['materials'][p['material']]['name'] != material_name]


# ------------------------------------------------------------------ volume du tissu


def tube_growth(pos, sel, rel_fn, coord, xs, rs, minimum=0.004):
    """Épaisseur à ajouter pour que chaque tranche du membre atteigne le rayon voulu (interpolé)."""
    rel = rel_fn(pos[sel])
    r = np.linalg.norm(rel, axis=1)
    c = coord[sel]
    bins = np.round(c / 0.02)
    mean_r = np.zeros_like(r)
    for b in np.unique(bins):
        mean_r[bins == b] = r[bins == b].mean()
    order = np.argsort(xs)
    target = np.interp(c, np.array(xs)[order], np.array(rs)[order])
    return np.maximum(target - mean_r, minimum)


def apply_tube(pos, sel, rel_fn, grow, cols):
    rel = rel_fn(pos[sel])
    r = np.maximum(np.linalg.norm(rel, axis=1), 1e-6)
    idx = np.nonzero(sel)[0]
    for k, col in enumerate(cols):
        pos[idx, col] += rel[:, k] / r * grow


# --------------------------------------------------------------------- yeux, silhouette


def mature_eyes(glb, sx, sy):
    """Yeux légèrement moins grands (surtout en hauteur) : un regard plus adulte. Les formes
    d'expression (clignement…) sont mises à l'échelle de la même façon."""
    j = glb.json
    face = next(m for m in j['meshes'] if m['name'] == 'Face')
    names = {'EyeIris_00_EYE', 'EyeWhite_00_EYE', 'EyeHighlight_00_EYE', 'FaceEyeline_00_FACE'}
    prims = [p for p in face['primitives'] if j['materials'][p['material']]['name'] in names]
    white = next(p for p in prims if j['materials'][p['material']]['name'] == 'EyeWhite_00_EYE')
    wpos = glb.accessor(white['attributes']['POSITION'])
    centers = {}
    for sgn in (-1, 1):
        q = wpos[np.sign(wpos[:, 0]) == sgn]
        centers[sgn] = (q.min(axis=0) + q.max(axis=0)) / 2
    done = set()
    for p in prims:
        acc = p['attributes']['POSITION']
        pos = glb.accessor(acc)
        side = np.where(pos[:, 0] >= 0, 1, -1)
        c = np.stack([centers[s_] for s_ in side])
        pos[:, 0] = c[:, 0] + (pos[:, 0] - c[:, 0]) * sx
        pos[:, 1] = c[:, 1] + (pos[:, 1] - c[:, 1]) * sy
        glb.write_accessor(acc, pos)
        for target in p.get('targets', []):
            ta = target.get('POSITION')
            if ta is None or ta in done:
                continue
            delta = glb.accessor(ta)
            delta[:, 0] *= sx
            delta[:, 1] *= sy
            glb.write_accessor(ta, delta)
            done.add(ta)


def world_matrices(j):
    nodes = j['nodes']
    parent = {c: i for i, n in enumerate(nodes) for c in n.get('children', [])}
    cache = {}

    def mat(i):
        if i not in cache:
            n = nodes[i]
            m = np.eye(4)
            m[:3, :3] = quat_mat(n.get('rotation', [0, 0, 0, 1])) * np.array(n.get('scale', [1, 1, 1]))
            m[:3, 3] = n.get('translation', [0, 0, 0])
            cache[i] = mat(parent[i]) @ m if i in parent else m
        return cache[i]

    return [mat(i) for i in range(len(nodes))], parent


def reshape_body(glb, wp, hb, legs, torso, arms, head, overall):
    """Change les proportions en respectant le squelette : jambes, buste et bras plus longs, tête
    plus petite, puis taille générale. Sommets (et formes d'expression), articulations, matrices de
    liaison, ressorts (cheveux), collisions et regard sont recalculés ensemble."""
    j = glb.json
    W, parent = world_matrices(j)
    cat = {}
    for name, node in hb.items():
        if name in ('leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'):
            cat[node] = 'leg'
        elif name in ('leftFoot', 'rightFoot', 'leftToes', 'rightToes'):
            cat[node] = 'foot'
        elif name in ('spine', 'chest', 'upperChest'):
            cat[node] = 'torso'
        elif name == 'neck':
            cat[node] = 'neck'
        elif name in ('leftShoulder', 'rightShoulder'):
            cat[node] = 'shoulder'
        elif name in ('leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'):
            cat[node] = 'arm'
        elif 'Hand' in name or any(f in name for f in ('Thumb', 'Index', 'Middle', 'Ring', 'Little')):
            cat[node] = 'hand'
        elif name in ('head', 'leftEye', 'rightEye', 'jaw'):
            cat[node] = 'head'
        elif name == 'hips':
            cat[node] = 'hips'

    def category(i):
        k = i
        while k is not None:
            if k in cat:
                return cat[k]
            k = parent.get(k)
        return None  # hors du squelette (racine, maillages) : inchangé

    ph = (wp[hb['leftUpperLeg']][1] + wp[hb['rightUpperLeg']][1]) / 2
    foot_y = (wp[hb['leftFoot']][1] + wp[hb['rightFoot']][1]) / 2
    hips_y, neck_y, sh_y = wp[hb['hips']][1], wp[hb['neck']][1], wp[hb['leftUpperArm']][1]
    ax, hand_x = abs(wp[hb['leftUpperArm']][0]), abs(wp[hb['leftHand']][0])
    head_j = wp[hb['head']]
    lift = (legs - 1) * (ph - foot_y)
    up_neck, up_arm = (torso - 1) * (neck_y - hips_y), (torso - 1) * (sh_y - hips_y)

    def deform(c, P):
        """Nouvelle position des points P (N×3) pour une catégorie d'os, et facteurs d'échelle."""
        Q = P.copy()
        A = np.ones(3)
        if c == 'leg':
            Q[:, 1] = ph + legs * (P[:, 1] - ph)
            A[1] = legs
        elif c == 'foot':
            Q[:, 1] += (legs - 1) * (foot_y - ph)
        elif c == 'torso':
            Q[:, 1] = hips_y + torso * (P[:, 1] - hips_y)
            A[1] = torso
        elif c == 'neck':
            Q[:, 1] += up_neck
        elif c == 'shoulder':
            Q[:, 1] += up_arm
        elif c == 'arm':
            sgn = np.sign(P[:, 0])
            Q[:, 0] = sgn * (ax + arms * (np.abs(P[:, 0]) - ax))
            Q[:, 1] += up_arm
            A[0] = arms
        elif c == 'hand':
            Q[:, 0] += np.sign(P[:, 0]) * (arms - 1) * (hand_x - ax)
            Q[:, 1] += up_arm
        elif c == 'head':
            Q = head_j + head * (P - head_j)
            Q[:, 1] += up_neck
            A[:] = head
        if c is None:
            return Q, A
        Q[:, 1] += lift
        return Q * overall, A * overall

    cats = [category(i) for i in range(len(j['nodes']))]

    # sommets et formes d'expression
    done = set()
    for ni, n in enumerate(j['nodes']):
        if 'mesh' not in n or 'skin' not in n:
            continue
        joints = j['skins'][n['skin']]['joints']
        for prim in j['meshes'][n['mesh']]['primitives']:
            a = prim['attributes']
            if a['POSITION'] in done:
                continue
            P = glb.accessor(a['POSITION'])
            J = glb.accessor(a['JOINTS_0']).astype(int)
            Wt = glb.accessor(a['WEIGHTS_0'])
            Wt = Wt / np.maximum(Wt.sum(axis=1, keepdims=True), 1e-9)
            nodes_of = np.array(joints)[J]
            newP = np.zeros_like(P)
            scale = np.zeros_like(P)
            for node in np.unique(nodes_of):
                w = (Wt * (nodes_of == node)).sum(axis=1)
                m = w > 0
                if not m.any():
                    continue
                Q, A = deform(cats[node], P[m])
                newP[m] += w[m, None] * Q
                scale[m] += w[m, None] * A
            glb.write_accessor(a['POSITION'], newP)
            done.add(a['POSITION'])
            for target in prim.get('targets', []):
                ta = target.get('POSITION')
                if ta is not None and ta not in done:
                    glb.write_accessor(ta, glb.accessor(ta) * scale)
                    done.add(ta)

    # articulations : nouvelles positions, orientations conservées
    newp = {}
    for i in range(len(j['nodes'])):
        Q, _ = deform(cats[i], W[i][:3, 3][None])
        newp[i] = Q[0]
    for i, n in enumerate(j['nodes']):
        if cats[i] is None:
            continue
        par = parent.get(i)
        if par is None:
            n['translation'] = newp[i].tolist()
        else:
            n['translation'] = (W[par][:3, :3].T @ (newp[i] - newp[par])).tolist()
    # matrices de liaison des peaux
    for skin in j['skins']:
        old = glb.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4)
        new = []
        for k, node in enumerate(skin['joints']):
            # pose de liaison d'origine (proche de la pose de repos) : seule sa position est déplacée
            B = np.linalg.inv(old[k].T)
            B[:3, 3] = deform(cats[node], B[:3, 3][None])[0][0]
            new.append(np.linalg.inv(B).T.reshape(16))
        glb.write_accessor(skin['inverseBindMatrices'], np.array(new))

    # ressorts (cheveux), collisions, regard
    def factor(i):
        _, A = deform(cats[i], W[i][:3, 3][None])
        return float(np.cbrt(A.prod()))

    sb = j['extensions'].get('VRMC_springBone', {})
    for col in sb.get('colliders', []):
        f = factor(col['node'])
        for shape in col['shape'].values():
            for key in ('offset', 'tail'):
                if key in shape:
                    shape[key] = [v * f for v in shape[key]]
            shape['radius'] *= f
    for spring in sb.get('springs', []):
        for jt in spring['joints']:
            if 'hitRadius' in jt:
                jt['hitRadius'] *= factor(jt['node'])
    look = j['extensions']['VRMC_vrm'].get('lookAt')
    if look and 'offsetFromHeadBone' in look:
        look['offsetFromHeadBone'] = [v * head * overall for v in look['offsetFromHeadBone']]
    top = max(newp[i][1] for i in range(len(newp)) if cats[i] == 'head')
    print(f'silhouette : tête à {newp[hb["head"]][1]:.2f} m, plus haut point du squelette {top:.2f} m')


# --------------------------------------------------------------------------- build


def main():
    glb = Glb(SRC)
    j = glb.json
    hb = {k: v['node'] for k, v in j['extensions']['VRMC_vrm']['humanoid']['humanBones'].items()}
    wp = world_positions(j)
    joint_nodes = j['skins'][0]['joints']  # le maillage « Body » utilise la peau 0

    # --- cheveux et sourcils blonds
    for name in ('Hair_00', 'HairBack_00'):
        i, img = glb.image(name)
        glb.set_image(i, blonde(img))
    i, img = glb.image('FaceBrow_00')
    a = np.asarray(img, np.float32)
    dark = luminance(img) < 0.7  # le sourcil (le fond est clair)
    brow = np.array([150, 112, 70], np.float32)
    a[dark] = a[dark] * 0.35 + brow * 0.65
    glb.set_image(i, Image.fromarray(a.astype(np.uint8)))
    i, img = glb.image('EyeIris_00')
    glb.set_image(i, eyes_blue(img))
    for m in j['materials']:
        if m['name'].endswith('_HAIR'):
            mt = m['extensions']['VRMC_materials_mtoon']
            mt['shadeColorFactor'] = [0.86, 0.74, 0.62]  # ombre chaude pour donner du volume
            mt['outlineColorFactor'] = [0.18, 0.11, 0.05]
        if m['name'] == 'FaceBrow_00_FACE':
            pass

    # --- chemise noire : col, patte de boutonnage, manches longues, logo
    i_top, top = glb.image('Tops_01')
    top = black_fabric(top, dark=(16, 16, 19), light=(46, 46, 53)).resize((top.width * 2, top.height * 2), Image.LANCZOS)
    tops = primitive(glb, 'Body', 'Tops_01_CLOTH')
    tp = tops['pos']
    front = tp[:, 2] > 0
    neck_front = tp[front & (np.abs(tp[:, 0]) < 0.012), 1].max()  # bas de l'encolure, devant
    neck_side = tp[front & (np.abs(np.abs(tp[:, 0]) - 0.055) < 0.012), 1].max()
    hem_y = tp[:, 1].min()
    top = paint_shirt_front(top, tops, neck_front, neck_side, hem_y)
    # logo à droite vu de face, à la place d'une poche de poitrine
    shoulder_x = abs(wp[hb['leftUpperArm']][0])
    top = project_decal(top, tops, LOGO_SIDE * shoulder_x * 0.62, neck_front - 0.105, LOGO_SIZE, LOGO_SIZE, logo_rgba(), soft=0.8)
    glb.set_image(i_top, top)
    for m in j['materials']:
        if m['name'] == 'Tops_01_CLOTH':
            mt = m['extensions']['VRMC_materials_mtoon']
            mt['shadeColorFactor'] = [0.62, 0.62, 0.68]
            mt['parametricRimColorFactor'] = [0.16, 0.16, 0.19]  # liseré de lumière : le noir garde du relief
            mt['parametricRimFresnelPowerFactor'] = 3.5
            mt['parametricRimLiftFactor'] = 0.0
            mt['outlineColorFactor'] = [0.02, 0.02, 0.025]

    # --- plus de short : un seul pantalon, de la taille aux chevilles
    remove_primitive(glb, 'Body', 'Bottoms_01_CLOTH')

    # --- peau habillée : jambes et bassin (pantalon), bras jusqu'aux poignets (manches longues)
    body = primitive(glb, 'Body', 'Body_00_SKIN')
    jn = np.array(joint_nodes)[body['joints'].astype(int)]  # nœud de chaque influence

    # os humanoïde de rattachement de chaque nœud (les os de torsion « J_Roll » comptent pour leur bras)
    _, parent_of = world_matrices(j)
    human_of = {}
    by_node = {v: k for k, v in hb.items()}
    for node in set(jn.ravel().tolist()):
        k = node
        while k is not None and k not in by_node:
            k = parent_of.get(k)
        human_of[node] = by_node.get(k)
    owner = np.vectorize(lambda n_: human_of.get(int(n_)) or '')(jn)

    def weight_of(names):
        return (np.isin(owner, list(names)) * body['weights']).sum(axis=1)

    leg_w = weight_of(('leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes'))
    arm_w = weight_of(('leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm'))
    pos = body['pos']
    x, y = pos[:, 0], pos[:, 1]
    hand_x = abs(wp[hb['leftHand']][0])
    waist_y = hem_y + 0.06  # le haut du pantalon reste caché sous la chemise
    is_leg = (y < waist_y) & ((leg_w > 0.15) | (np.abs(x) < 0.2))
    is_arm = (arm_w > 0.5) & (np.abs(x) < hand_x - 0.012)
    idx = body['idx']
    tri_cloth = (is_leg | is_arm)[idx].all(axis=1) | (is_leg[idx].any(axis=1) & (y[idx] < waist_y - 0.02).all(axis=1))
    i_body, skin = glb.image('Body_00')
    mask = raster_triangles(skin.size, body['uv'][idx[tri_cloth]])
    skin_mask = raster_triangles(skin.size, body['uv'][idx[~tri_cloth]])
    grown = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13)), np.uint8) > 0
    mask_img = Image.fromarray(((mask | (grown & ~skin_mask)) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    # poignets : revers de manche (bande légèrement plus claire, liseré)
    arm_tris = idx[tri_cloth & is_arm[idx].any(axis=1)]
    arm_mask, ax_val = raster_triangles(skin.size, body['uv'][arm_tris], np.abs(x)[arm_tris][..., None].astype(np.float32))
    arm_mask = np.asarray(Image.fromarray((arm_mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(9)), np.uint8) > 0
    ax_val = ax_val[..., 0]
    cuff = (ax_val > hand_x - 0.065) & (ax_val < hand_x - 0.012)
    cuff_line = (ax_val > hand_x - 0.068) & (ax_val < hand_x - 0.062)
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1, (skin.height, skin.width)).astype(np.float32)
    noise = np.asarray(Image.fromarray(((noise * 18) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) - 128
    fabric = np.clip(np.array([30, 30, 35], np.float32) + noise[..., None] * 0.08, 0, 255)
    # manches : même teinte que la chemise (le pantalon est un peu plus sombre)
    fabric[arm_mask] = np.clip(np.array(SHIRT, np.float32) + noise[arm_mask][:, None] * 0.08, 0, 255)
    fabric[cuff] = [s + 6 for s in SHIRT]
    fabric[cuff_line] = [s + 30 for s in SHIRT]
    sk = np.asarray(skin, np.float32)
    k = np.asarray(mask_img, np.float32)[..., None] / 255
    glb.set_image(i_body, Image.fromarray(np.clip(fabric * k + sk * (1 - k), 0, 255).astype(np.uint8)))
    # La peau a une ombre rosée (shadeColorFactor) qui teinterait le tissu en violet : texture
    # d'ombre séparée où le tissu est compensé pour rester gris anthracite dans l'ombre.
    skin_mat = next(m for m in j['materials'] if m['name'] == 'Body_00_SKIN')
    factor = np.array(skin_mat['extensions']['VRMC_materials_mtoon']['shadeColorFactor'], np.float32)
    shade_fabric = np.clip(np.array([17, 17, 20], np.float32) / factor + noise[..., None] * 0.05, 0, 255)
    shade_fabric[arm_mask] = np.array(SHIRT, np.float32) * 0.62 / factor
    shade_fabric[cuff_line] = np.array([s + 20 for s in SHIRT], np.float32) * 0.62 / factor
    shade_img = Image.fromarray(np.clip(shade_fabric * k + sk * (1 - k), 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    shade_img.save(buf, 'PNG', optimize=True)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': 0, 'byteLength': 0})
    glb.replaced[len(j['bufferViews']) - 1] = buf.getvalue()
    j['images'].append({'name': 'Body_00_shade', 'mimeType': 'image/png', 'bufferView': len(j['bufferViews']) - 1})
    j['textures'].append({'source': len(j['images']) - 1, 'sampler': j['textures'][skin_mat['pbrMetallicRoughness']['baseColorTexture']['index']].get('sampler', 0)})
    skin_mat['extensions']['VRMC_materials_mtoon']['shadeMultiplyTexture'] = {'index': len(j['textures']) - 1}

    # --- volume du tissu
    new_pos = pos.copy()
    foot_y = max(wp[hb['leftFoot']][1], wp[hb['rightFoot']][1])
    for side in ('left', 'right'):
        # jambes : tube de tissu de coupe droite, du haut des cuisses aux chevilles
        hip, knee, foot = (wp[hb[f'{side}{b}']] for b in ('UpperLeg', 'LowerLeg', 'Foot'))
        ys_axis = np.array([foot[1], knee[1], hip[1]])

        def leg_axis(yv):
            return np.stack([np.interp(yv, ys_axis, [foot[0], knee[0], hip[0]]), np.interp(yv, ys_axis, [foot[2], knee[2], hip[2]])], -1)

        sel = is_leg & (leg_w > 0.15) & (np.sign(x) == np.sign(hip[0]))
        thigh_y, ankle_y = hip[1] - 0.12, foot_y + 0.07
        grow = tube_growth(new_pos, sel, lambda p: p[:, [0, 2]] - leg_axis(p[:, 1]), y, [ankle_y, thigh_y], [0.056, 0.072])
        grow *= np.clip(1 - (y[sel] - thigh_y) / 0.1, 0.5, 1)  # vers le bassin : simple épaisseur
        grow *= np.clip((y[sel] - (foot_y + 0.015)) / 0.05, 0, 1)  # le tissu se pose sur la chaussure
        apply_tube(new_pos, sel, lambda p: p[:, [0, 2]] - leg_axis(p[:, 1]), grow, [0, 2])

        # bras : manche longue qui prolonge la manche courte de la chemise
        sgn = 1 if side == 'left' else -1
        arm0, hand = wp[hb[f'{side}UpperArm']], wp[hb[f'{side}Hand']]

        def arm_axis(xv):
            t_ = (xv - arm0[0]) / (hand[0] - arm0[0])
            return np.stack([arm0[1] + t_ * (hand[1] - arm0[1]), arm0[2] + t_ * (hand[2] - arm0[2])], -1)

        sleeve_x = (sgn * tp[:, 0]).max()
        ring = tp[sgn * tp[:, 0] > sleeve_x - 0.01]
        sleeve_r = np.linalg.norm(ring[:, [1, 2]] - arm_axis(ring[:, 0]), axis=1).mean()
        sel = is_arm & (sgn * x > sleeve_x - 0.03)
        wrist_x = hand_x - 0.015
        grow = tube_growth(new_pos, sel, lambda p: p[:, [1, 2]] - arm_axis(p[:, 0]), sgn * x, [sleeve_x, wrist_x], [sleeve_r - 0.004, 0.0], minimum=0.007)
        grow *= np.clip((wrist_x + 0.01 - sgn * x[sel]) / 0.012, 0, 1)
        apply_tube(new_pos, sel, lambda p: p[:, [1, 2]] - arm_axis(p[:, 0]), grow, [1, 2])
        print(f'{side} : manche {sleeve_x:.3f} m (rayon {sleeve_r:.3f}), bas de chemise {hem_y:.3f} m')
    # bassin : épaisseur du tissu
    pelvis = (y < waist_y) & (leg_w <= 0.15) & (np.abs(x) < 0.2)
    new_pos[pelvis] += body['nrm'][pelvis] * 0.006
    glb.write_accessor(body['pos_acc'], new_pos)

    # --- visage plus adulte : yeux un peu moins grands, surtout en hauteur
    mature_eyes(glb, sx=0.9, sy=0.84)

    # --- silhouette adulte : jambes et buste plus longs, tête plus petite, plus grande
    reshape_body(glb, wp, hb, legs=1.12, torso=1.05, arms=1.07, head=0.9, overall=1.04)

    # --- métadonnées et vignette (portrait rendu dans l'application : scripts/assets/claire-thumbnail.jpg)
    meta = j['extensions']['VRMC_vrm']['meta']
    thumb = ROOT / 'scripts' / 'assets' / 'claire-thumbnail.jpg'
    if thumb.exists():
        index = meta['thumbnailImage']
        glb.replaced[j['images'][index]['bufferView']] = thumb.read_bytes()
        j['images'][index]['mimeType'] = 'image/jpeg'
    meta['name'] = 'Claire'
    meta['authors'] = ['pixiv Inc.', 'Avatar3D (adaptation : Claire)']
    meta['version'] = 'claire-1.0'

    glb.save(OUT)
    print(f'{OUT.relative_to(ROOT)} : {OUT.stat().st_size / 1e6:.1f} Mo')


if __name__ == '__main__':
    main()
