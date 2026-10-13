#!/usr/bin/env python3
"""
Génère l'avatar « Claire » (public/avatars/claire.vrm) à partir du modèle d'exemple de pixiv
(public/avatars/default.vrm, licence VRM 1.0 : modification et redistribution autorisées,
usage commercial autorisé).

Claire : femme d'une trentaine d'années, cheveux blonds, yeux bleu-gris, t-shirt noir avec un petit
logo Orange en haut à gauche (vu de face), pantalon noir.

- cheveux et sourcils recolorés en blond (le relief des mèches est conservé) ;
- t-shirt noir (les plis sont conservés), texture doublée (2048 × 4096) pour un logo net ;
- logo placé par lancer de rayons sur le maillage du t-shirt : il suit la courbure de la poitrine ;
- pantalon : le short devient noir et les jambes sont « habillées » (texture peinte d'après les os
  des jambes, volume légèrement augmenté pour l'épaisseur du tissu, qui s'élargit vers le bas).

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
LOGO_SIZE = 0.05  # côté du logo, en mètres
# Côté du logo : -1 = à gauche vu de face (côté droit de la personne), +1 = de l'autre côté.
LOGO_SIDE = -1


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

    def accessor(self, index):
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

    # --- t-shirt noir + logo
    i_top, top = glb.image('Tops_01')
    top = black_fabric(top).resize((top.width * 2, top.height * 2), Image.LANCZOS)
    tops = primitive(glb, 'Body', 'Tops_01_CLOTH')
    neck, chest = wp[hb['neck']], wp[hb['upperChest']]
    shoulder_x = abs(wp[hb['leftUpperArm']][0])
    cx = LOGO_SIDE * shoulder_x * 0.52
    cy = neck[1] - 0.115
    # grille de points du logo projetés sur le t-shirt -> coordonnées UV (suit la courbure)
    n = 10
    grid = np.zeros((n + 1, n + 1, 2))
    for gy in range(n + 1):
        for gx in range(n + 1):
            x = cx + (gx / n - 0.5) * LOGO_SIZE
            y = cy + (0.5 - gy / n) * LOGO_SIZE
            uv = raycast_front(tops, x, y)
            if uv is None:
                raise SystemExit(f'Logo hors du t-shirt en ({x:.3f}, {y:.3f})')
            grid[gy, gx] = uv
    logo = np.asarray(logo_image(), np.float32)
    tris, vals = [], []
    for gy in range(n):
        for gx in range(n):
            q = [(gy, gx), (gy, gx + 1), (gy + 1, gx + 1), (gy + 1, gx)]
            uvq = [grid[a, b] for a, b in q]
            stq = [(b / n, a / n) for a, b in q]
            for t in ((0, 1, 2), (0, 2, 3)):
                tris.append(np.array([uvq[k] for k in t]))
                vals.append(np.array([stq[k] for k in t]))
    mask, st = raster_triangles(top.size, np.array(tris), np.array(vals, np.float32))
    a = np.asarray(top, np.float32).copy()
    ys, xs = np.nonzero(mask)
    s = np.clip(st[ys, xs, 0] * (logo.shape[1] - 1), 0, logo.shape[1] - 1)
    t = np.clip(st[ys, xs, 1] * (logo.shape[0] - 1), 0, logo.shape[0] - 1)
    # échantillonnage bilinéaire du logo
    s0, t0 = np.floor(s).astype(int), np.floor(t).astype(int)
    s1, t1 = np.minimum(s0 + 1, logo.shape[1] - 1), np.minimum(t0 + 1, logo.shape[0] - 1)
    fs, ft = (s - s0)[:, None], (t - t0)[:, None]
    col = (logo[t0, s0] * (1 - fs) + logo[t0, s1] * fs) * (1 - ft) + (logo[t1, s0] * (1 - fs) + logo[t1, s1] * fs) * ft
    # le logo est imprimé sur le tissu : légère trace des plis
    shade = (luminance(Image.fromarray(a.astype(np.uint8)))[ys, xs] - 0.12)[:, None]
    a[ys, xs] = np.clip(col * (0.94 + shade * 0.4), 0, 255)
    # bord net mais sans crénelage : on lisse uniquement le contour du logo
    edge = Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    soft = np.asarray(edge, np.float32)[..., None] / 255
    orig = np.asarray(top, np.float32)
    top = Image.fromarray(np.clip(a * soft + orig * (1 - soft), 0, 255).astype(np.uint8))
    glb.set_image(i_top, top)
    for m in j['materials']:
        if m['name'] == 'Tops_01_CLOTH':
            mt = m['extensions']['VRMC_materials_mtoon']
            mt['shadeColorFactor'] = [0.62, 0.62, 0.68]
            mt['parametricRimColorFactor'] = [0.16, 0.16, 0.19]  # liseré de lumière : le noir garde du relief
            mt['parametricRimFresnelPowerFactor'] = 3.5
            mt['parametricRimLiftFactor'] = 0.0
            mt['outlineColorFactor'] = [0.02, 0.02, 0.025]

    # --- short noir mat (devient le haut du pantalon)
    i_bot, bot = glb.image('Bottoms_01')
    # même tissu que le pantalon : seuls les plis restent, très atténués (plus de revers brillant)
    l = luminance(bot)
    shade = np.clip((l - np.median(l[l > 0.02])) * 0.5, -0.04, 0.05)
    a = np.clip(np.array([25, 25, 29], np.float32) + shade[..., None] * 160, 0, 255)
    glb.set_image(i_bot, Image.fromarray(a.astype(np.uint8)))
    for m in j['materials']:
        if m['name'] == 'Bottoms_01_CLOTH':
            mt = m['extensions']['VRMC_materials_mtoon']
            # mêmes réglages d'ombre que le tissu des jambes, pour un pantalon d'un seul tenant
            mt['shadeColorFactor'] = [0.68, 0.68, 0.71]

    # --- jambes : pantalon noir
    body = primitive(glb, 'Body', 'Body_00_SKIN')
    leg_bones = {hb[k] for k in ('leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'leftToes', 'rightToes')}
    jn = np.array(joint_nodes)[body['joints'].astype(int)]  # nœud de chaque influence
    leg_w = (np.isin(jn, list(leg_bones)) * body['weights']).sum(axis=1)
    hips_y = wp[hb['hips']][1]
    pos = body['pos']
    is_leg = (leg_w > 0.5) | ((pos[:, 1] < hips_y - 0.04) & (leg_w > 0.15))
    tri_leg = is_leg[body['idx']].any(axis=1)
    i_body, skin = glb.image('Body_00')
    mask = raster_triangles(skin.size, body['uv'][body['idx'][tri_leg]])
    # Marge autour des zones peintes (évite un liseré couleur peau aux coutures de la texture),
    # sans déborder sur la peau visible (bras, ventre…).
    skin_mask = raster_triangles(skin.size, body['uv'][body['idx'][~tri_leg]])
    grown = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(13)), np.uint8) > 0
    mask_img = Image.fromarray(((mask | (grown & ~skin_mask)) * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    rng = np.random.default_rng(7)
    noise = rng.normal(0, 1, (skin.height, skin.width)).astype(np.float32)
    noise = np.asarray(Image.fromarray(((noise * 18) + 128).clip(0, 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2)), np.float32) - 128
    fabric = np.clip(np.array([30, 30, 35], np.float32) + noise[..., None] * 0.08, 0, 255)
    sk = np.asarray(skin, np.float32)
    k = np.asarray(mask_img, np.float32)[..., None] / 255
    glb.set_image(i_body, Image.fromarray(np.clip(fabric * k + sk * (1 - k), 0, 255).astype(np.uint8)))
    # La peau a une ombre rosée (shadeColorFactor) qui teinterait le pantalon en violet : texture
    # d'ombre séparée où le tissu est compensé pour rester gris anthracite dans l'ombre.
    skin_mat = next(m for m in j['materials'] if m['name'] == 'Body_00_SKIN')
    factor = np.array(skin_mat['extensions']['VRMC_materials_mtoon']['shadeColorFactor'], np.float32)
    shade_fabric = np.clip(np.array([17, 17, 20], np.float32) / factor + noise[..., None] * 0.05, 0, 255)
    shade_img = Image.fromarray(np.clip(shade_fabric * k + sk * (1 - k), 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    shade_img.save(buf, 'PNG', optimize=True)
    j['bufferViews'].append({'buffer': 0, 'byteOffset': 0, 'byteLength': 0})
    glb.replaced[len(j['bufferViews']) - 1] = buf.getvalue()
    j['images'].append({'name': 'Body_00_shade', 'mimeType': 'image/png', 'bufferView': len(j['bufferViews']) - 1})
    j['textures'].append({'source': len(j['images']) - 1, 'sampler': j['textures'][skin_mat['pbrMetallicRoughness']['baseColorTexture']['index']].get('sampler', 0)})
    skin_mat['extensions']['VRMC_materials_mtoon']['shadeMultiplyTexture'] = {'index': len(j['textures']) - 1}

    # Forme du pantalon : chaque jambe devient un tube de tissu qui prolonge le bas du short,
    # légèrement fuselé jusqu'à la cheville (coupe droite), au lieu de coller à la peau.
    bottoms = primitive(glb, 'Body', 'Bottoms_01_CLOTH')
    hem_y = bottoms['pos'][:, 1].min()
    foot_y = max(wp[hb['leftFoot']][1], wp[hb['rightFoot']][1])
    y = pos[:, 1]
    new_pos = pos.copy()
    for side in ('left', 'right'):
        hip, knee, foot = (wp[hb[f'{side}{b}']] for b in ('UpperLeg', 'LowerLeg', 'Foot'))
        ys_axis = np.array([foot[1], knee[1], hip[1]])

        def axis(yv):
            return np.stack([np.interp(yv, ys_axis, [foot[0], knee[0], hip[0]]), np.interp(yv, ys_axis, [foot[2], knee[2], hip[2]])], -1)

        sel = is_leg & (np.sign(pos[:, 0]) == np.sign(hip[0])) & (y < hem_y + 0.06)
        # rayon du bas du short autour de l'axe de la jambe
        bp = bottoms['pos']
        ring = bp[(bp[:, 1] < hem_y + 0.012) & (np.sign(bp[:, 0]) == np.sign(hip[0]))]
        hem_r = np.linalg.norm(ring[:, [0, 2]] - axis(ring[:, 1]), axis=1).mean()
        top_r = hem_r - 0.004  # juste à l'intérieur du short : le raccord ne se voit pas
        ankle_y = foot_y + 0.07
        bottom_r = 0.056
        rel = pos[sel][:, [0, 2]] - axis(y[sel])
        r = np.linalg.norm(rel, axis=1)
        # rayon moyen de la jambe à chaque hauteur (tranches de 2 cm)
        bins = np.round(y[sel] / 0.02)
        mean_r = np.array([r[bins == b_].mean() for b_ in bins])
        target = np.interp(y[sel], [ankle_y, hem_y], [bottom_r, top_r])
        grow = np.maximum(target - mean_r, 0.004)
        # au-dessus du bas du short : retour progressif vers la peau (caché sous le short)
        grow *= np.clip(1 - (y[sel] - hem_y) / 0.05, 0.15, 1)
        # vers le pied : le tissu se pose sur la chaussure
        grow *= np.clip((y[sel] - (foot_y + 0.015)) / 0.05, 0, 1)
        new_r = r + grow
        new_pos[np.nonzero(sel)[0][:, None], [0, 2]] = axis(y[sel]) + rel / np.maximum(r, 1e-6)[:, None] * new_r[:, None]
        print(f'jambe {side} : bas du short {hem_y:.3f} m, rayon {hem_r:.3f} m')
    glb.write_accessor(body['pos_acc'], new_pos)

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
