#!/usr/bin/env python3
"""
Génère l'avatar « Camille » (public/avatars/camille.vrm) à partir du modèle d'exemple de pixiv
(public/avatars/default.vrm, licence VRM 1.0 : modification et redistribution autorisées,
usage commercial autorisé).

Camille : femme d'une trentaine d'années, brune, habillée en blanc (chemise à manches longues et
pantalon), avec une chasuble rouge de la CGT : grand logo dans le dos, petit logo à droite sur le
devant (vu de face). Logo fourni : scripts/assets/cgt-logo.jpg.

- cheveux bruns coupés au-dessus des épaules (le relief des mèches est conservé ; le logo du dos,
  entre les omoplates, reste visible), sourcils bruns ;
- chemise blanche : col, patte de boutonnage, boutons, manches longues avec revers ;
- chasuble rouge sans manches par-dessus (encolure en V devant, ronde derrière, emmanchures),
  peinte d'après la position de chaque point du vêtement, avec un biais plus foncé sur les bords ;
- pantalon blanc d'un seul tenant (le short est retiré) ;
- silhouette adulte, comme Claire (squelette, liaisons, ressorts et regard recalculés).

Usage : python3 scripts/build-camille.py   (nécessite Python 3, numpy et Pillow)
"""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from vroid_kit import (
    ROOT,
    SRC,
    WHITE_SHIRT,
    Glb,
    dress_body,
    finish,
    gradient,
    luminance,
    mature_eyes,
    normalize,
    paint_shirt_front,
    primitive,
    project_decal,
    raster_triangles,
    remove_primitive,
    reshape_body,
    settle_springs,
    shorten_hair,
    scene,
    shirt_landmarks,
)

OUT = ROOT / 'public' / 'avatars' / 'camille.vrm'
LOGO = ROOT / 'scripts' / 'assets' / 'cgt-logo.jpg'
THUMB = ROOT / 'scripts' / 'assets' / 'camille-thumbnail.jpg'

RED = (214, 16, 28)  # rouge CGT
BINDING = (150, 10, 20)  # biais des bords de la chasuble
BRUNETTE = [(0.0, (30, 18, 13)), (0.4, (62, 38, 26)), (0.75, (98, 62, 40)), (1.0, (140, 96, 66))]
# Manches et pantalon blancs, peints sur la peau (dont le matériau s'éclaire un peu différemment) :
# teintes mesurées sur un rendu pour se confondre avec la chemise.
SLEEVES = (250, 250, 252)
TROUSERS = (246, 246, 249)


# ------------------------------------------------------------------------------- logos


def logo_images():
    """Logo complet (dos) et badge seul (poitrine), chacun sur une pièce blanche aux coins arrondis."""
    a = np.asarray(Image.open(LOGO).convert('RGB')).astype(int)
    H, W = a.shape[:2]

    def patch(img, pad=0.06, radius=0.08):
        rgb = np.asarray(img).astype(np.uint8)
        h, w = rgb.shape[:2]
        p = int(max(h, w) * pad)
        out = Image.new('RGB', (w + 2 * p, h + 2 * p), 'white')
        out.paste(Image.fromarray(rgb), (p, p))
        alpha = Image.new('L', out.size, 0)
        ImageDraw.Draw(alpha).rounded_rectangle([0, 0, out.width - 1, out.height - 1], radius=int(max(out.size) * radius), fill=255)
        return np.concatenate([np.asarray(out, np.float32), np.asarray(alpha, np.float32)[..., None]], -1)

    def crop(b):
        ys, xs = np.nonzero(b.min(-1) < 225)
        return b[ys.min() : ys.max() + 1, xs.min() : xs.max() + 1]

    full = patch(crop(a))
    # badge : on retire le texte (« DTOF DSI / Opérations ») et le trait rouge à droite du drapeau
    b = a.copy()
    red = (a[..., 0] > 150) & (a[..., 1] < 110) & (a[..., 2] < 110)
    for x in range(380, W):  # trait fin : courtes séries verticales de rouge
        col, y = red[:, x], 0
        while y < H:
            if col[y]:
                y0 = y
                while y < H and col[y]:
                    y += 1
                if y - y0 < 16 and y0 < 260:
                    b[max(0, y0 - 3) : y + 3, x] = 255
            else:
                y += 1
    yy, xx = np.mgrid[0:H, 0:W]
    b[:235, 470:] = 255
    grey = (a.max(-1) - a.min(-1)) < 60  # texte noir et son anticrénelage gris
    b[grey & (xx > 455) & (yy < 275)] = 255
    badge = patch(crop(b), pad=0.08)
    return full, badge


# ----------------------------------------------------------------------------- chasuble


def paint_vest(top, tops, wp, hb, neck_front, hem_y):
    """Chasuble rouge sans manches : chaque pixel de la texture est rattaché à sa position sur le
    vêtement (interpolée entre les sommets), ce qui donne des bords nets indépendants du maillage."""
    idx = tops['idx']
    covered, pos = raster_triangles(top.size, tops['uv'][idx], tops['pos'][idx].astype(np.float32))
    x, y, z = pos[..., 0], pos[..., 1], pos[..., 2]
    sh_y = wp[hb['leftUpperArm']][1]
    tp = tops['pos']
    neck_back = tp[(tp[:, 2] < 0) & (np.abs(tp[:, 0]) < 0.012), 1].max()
    # distances (en mètres) aux bords : emmanchure, encolure en V devant, encolure ronde derrière
    # bretelles larges qui passent par-dessus les épaules (devant et dos se rejoignent)
    armhole = np.interp(y, [sh_y - 0.14, sh_y - 0.06, sh_y + 0.04], [0.26, 0.15, 0.135]) - np.abs(x)
    v_bottom = neck_front - 0.17
    v_half = np.minimum((y - v_bottom) * 0.48, 0.066)  # le V s'arrête de s'élargir près du cou
    vneck = np.where((z > 0) & (y > v_bottom), np.abs(x) - v_half, 1.0)
    # encolure ronde derrière (et non une coupe horizontale sur toute la largeur)
    ry, rx, cy_ = 0.045, 0.07, neck_back + 0.012
    rneck = np.where(z <= 0, (np.sqrt((x / rx) ** 2 + ((y - cy_) / ry) ** 2) - 1) * ry, 1.0)
    d = np.minimum(np.minimum(armhole, vneck), rneck)
    inside = covered & (d > 0)
    binding = inside & (d < 0.009)
    a = np.asarray(top, np.float32).copy()
    fold = normalize(luminance(top), 1, 99)[..., None]  # plis du tissu d'origine
    red = np.array(RED, np.float32) * (0.72 + 0.34 * fold)
    bind = np.array(BINDING, np.float32) * (0.8 + 0.25 * fold)
    a[inside] = red[inside]
    a[binding] = bind[binding]
    # bord sans crénelage
    m = Image.fromarray((inside * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7))
    k = np.asarray(m, np.float32)[..., None] / 255
    out = a * k + np.asarray(top, np.float32) * (1 - k)
    return Image.fromarray(np.clip(out, 0, 255).astype(np.uint8))


# ------------------------------------------------------------------------------- build


def main():
    glb = Glb(SRC)
    j = glb.json
    hb, wp = scene(glb)

    # --- cheveux et sourcils bruns
    for name in ('Hair_00', 'HairBack_00'):
        i, img = glb.image(name)
        glb.set_image(i, gradient(normalize(luminance(img)), BRUNETTE))
    i, img = glb.image('FaceBrow_00')
    a = np.asarray(img, np.float32)
    dark = luminance(img) < 0.7
    a[dark] = a[dark] * 0.3 + np.array([52, 34, 24], np.float32) * 0.7
    glb.set_image(i, Image.fromarray(a.astype(np.uint8)))
    # coupe au-dessus des épaules : le logo du dos, entre les omoplates, reste visible
    shorten_hair(glb, cut=1.32, keep=0.3, follow=True)
    for m in j['materials']:
        if m['name'].endswith('_HAIR'):
            mt = m['extensions']['VRMC_materials_mtoon']
            mt['shadeColorFactor'] = [0.78, 0.68, 0.62]
            mt['outlineColorFactor'] = [0.08, 0.05, 0.03]

    # --- chemise blanche (col, patte, boutons) + chasuble rouge + logos
    i_top, top = glb.image('Tops_01')
    l = normalize(luminance(top), 0.5, 99.5)
    top = gradient(l, [(0, (214, 216, 224)), (1, (252, 252, 254))]).resize((top.width * 2, top.height * 2), Image.LANCZOS)
    tops = primitive(glb, 'Body', 'Tops_01_CLOTH')
    tp = tops['pos']
    neck_front, neck_side, hem_y = shirt_landmarks(tp)
    top = paint_shirt_front(top, tops, neck_front, neck_side, hem_y, colors=WHITE_SHIRT)
    top = paint_vest(top, tops, wp, hb, neck_front, hem_y)
    full, badge = logo_images()
    shoulder_x = abs(wp[hb['leftUpperArm']][0])
    # petit logo à droite vu de face, sur la chasuble
    bw = 0.055
    top = project_decal(top, tops, shoulder_x * 0.66, neck_front - 0.105, bw, bw * badge.shape[0] / badge.shape[1], badge, soft=0.8)
    # logo du dos, entre les omoplates
    fw = 0.19
    top = project_decal(top, tops, 0.0, neck_front - 0.11, fw, fw * full.shape[0] / full.shape[1], full, n=32, soft=0.8, back=True)
    glb.set_image(i_top, top)
    for m in j['materials']:
        if m['name'] == 'Tops_01_CLOTH':
            mt = m['extensions']['VRMC_materials_mtoon']
            mt['shadeColorFactor'] = [0.8, 0.81, 0.87]  # ombre neutre : le blanc ne bleuit pas

    # --- pantalon blanc seul, manches longues blanches
    remove_primitive(glb, 'Body', 'Bottoms_01_CLOTH')
    dress_body(
        glb, wp, hb, tp, hem_y,
        legs=TROUSERS, legs_shade=[c * 0.8 for c in TROUSERS],
        sleeves=SLEEVES, sleeves_shade=[c * 0.8 for c in SLEEVES],
        cuff=[c - 4 for c in SLEEVES], cuff_line=(226, 226, 233), cuff_line_shade=(186, 186, 196),
        neutral_shade=True, cuff_width=0.04,
    )

    # --- visage et silhouette adultes
    mature_eyes(glb, sx=0.9, sy=0.84)
    reshape_body(glb, wp, hb, legs=1.11, torso=1.05, arms=1.07, head=0.9, overall=1.03)
    # pointes de cheveux qui démarrent dans une zone de collision : plus simulées (sinon elles flottent)
    print(f'mèches stabilisées : {settle_springs(glb)} articulations')

    finish(glb, OUT, 'Camille', THUMB)


if __name__ == '__main__':
    main()
