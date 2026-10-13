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

from vroid_kit import *  # noqa: F401,F403
from vroid_kit import ROOT, SRC

OUT = ROOT / 'public' / 'avatars' / 'claire.vrm'

ORANGE = (255, 121, 0)  # orange de la marque (#FF7900)
# Teinte des manches longues (peintes sur la peau) : plus claire que le tissu de la chemise car le
# matériau de la peau s'éclaire moins ; mesurée sur un rendu pour que les deux se confondent.
SHIRT = (46, 46, 55)
LOGO_SIZE = 0.046  # côté du logo, en mètres
# Côté du logo : +1 = à droite vu de face (côté cœur de la personne), -1 = de l'autre côté.
LOGO_SIDE = 1


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


def logo_rgba():
    img = np.asarray(logo_image(), np.float32)
    return np.concatenate([img, np.full(img.shape[:2] + (1,), 255, np.float32)], -1)


# --------------------------------------------------------------------------- build


def main():
    glb = Glb(SRC)
    j = glb.json
    hb = {k: v['node'] for k, v in j['extensions']['VRMC_vrm']['humanoid']['humanBones'].items()}
    wp = world_positions(j)

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

    # --- peau habillée : pantalon (jambes et bassin), manches longues jusqu'aux poignets
    s = SHIRT
    dress_body(glb, wp, hb, tp, hem_y, legs=(30, 30, 35), legs_shade=(17, 17, 20), sleeves=s, sleeves_shade=[c * 0.62 for c in s],
               cuff=[c + 6 for c in s], cuff_line=[c + 30 for c in s], cuff_line_shade=[(c + 20) * 0.62 for c in s])

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
