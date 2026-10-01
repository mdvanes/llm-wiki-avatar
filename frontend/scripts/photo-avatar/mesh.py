"""Step 2: builds the deformable photo mesh (vertices, triangles, displacement fields) for the WebGL avatar.

Usage: mesh.py <out.ts> <subject.webp> <background.webp>
The subject (cut.png) is drawn on the mesh; the background is frame.png with the subject filled in, so the head can
move without showing a ghost of itself.
"""
import json, sys, urllib.request, os
import cv2, numpy as np, triangle
from PIL import Image

OBJ = 'canonical_face_model.obj'
if not os.path.exists(OBJ):
    urllib.request.urlretrieve('https://raw.githubusercontent.com/google-ai-edge/mediapipe/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj', OBJ)

cut = Image.open('cut.png')
W, H = cut.size
P = np.array(json.load(open('landmarks.json')), float)  # 478 landmarks in photo px

OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149,
        150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
UI = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308]  # inner lip, upper (corner to corner)
LI = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308]  # inner lip, lower
# Eyes: L is on the viewer's left. Upper/lower lid from outer to inner corner, same length.
EYES = {
    'L': {'up': [33, 246, 161, 160, 159, 158, 157, 173, 133], 'lo': [33, 7, 163, 144, 145, 153, 154, 155, 133],
          'iris': [468, 469, 470, 471, 472], 'brow': [46, 53, 52, 65, 55, 70, 63, 105, 66, 107]},
    'R': {'up': [263, 466, 388, 387, 386, 385, 384, 398, 362], 'lo': [263, 249, 390, 373, 374, 380, 381, 382, 362],
          'iris': [473, 474, 475, 476, 477], 'brow': [276, 283, 282, 295, 285, 300, 293, 334, 296, 336]},
}

def in_poly(pt, poly):
    x, y = pt; inside = False
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[i - 1]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside

verts = [tuple(p) for p in P]
tris = []

# 1. Face: MediaPipe's tessellation without the mouth opening and the eye openings.
faces = [[int(v.split('/')[0]) - 1 for v in l.split()[1:]] for l in open(OBJ) if l.startswith('f ')]
mouth_set = set(UI + LI)
eye_sets = [set(e['up'] + e['lo']) for e in EYES.values()]
for t in faces:
    if set(t) <= mouth_set or any(set(t) <= s for s in eye_sets):
        continue
    tris.append(t)

# 2. Eyes: re-meshed with the visible iris points, so the iris can move for gaze.
eye_iris = {}
for side, e in EYES.items():
    ring = e['up'] + e['lo'][1:-1][::-1]
    poly = [P[i] for i in ring]
    inner = []
    for i in e['iris']:
        # Keep iris points well inside the opening; the lids hide the rest.
        if in_poly(P[i], poly) and min(np.linalg.norm(P[i] - P[j]) for j in ring) > 2.5:
            inner.append(i)
    eye_iris[side] = inner
    idx = ring + inner
    seg = [[k, (k + 1) % len(ring)] for k in range(len(ring))]
    r = triangle.triangulate({'vertices': np.array([P[i] for i in idx]), 'segments': np.array(seg)}, 'pQY')
    assert len(r['vertices']) == len(idx), 'eye mesh added points'
    tris += [[idx[a] for a in t] for t in r['triangles']]

# 3. Around the face: hair, ears, neck and shirt, on a grid that follows the face outline.
oval = [P[i] for i in OVAL]
STEP = 42
grid = []
for y in np.arange(0, H + 1, STEP):
    for x in np.arange(0, W + 1, STEP):
        q = np.array([min(x, W), min(y, H)], float)
        if in_poly(q, oval) or min(np.linalg.norm(q - o) for o in oval) < STEP * 0.55:
            continue
        grid.append(q)
for x in np.arange(0, W + 1, STEP / 2):  # denser border, so the image edges stay straight
    for y in (0, H):
        grid.append(np.array([min(x, W), y], float))
for y in np.arange(0, H + 1, STEP / 2):
    for x in (0, W):
        grid.append(np.array([x, min(y, H)], float))
grid = list({(round(g[0], 1), round(g[1], 1)): g for g in grid}.values())
pts = oval + grid
n_oval = len(OVAL)
seg = [[k, (k + 1) % n_oval] for k in range(n_oval)]
r = triangle.triangulate({'vertices': np.array(pts, float), 'segments': np.array(seg), 'holes': np.array([P[1]], float)}, 'pcQ')
base = len(verts)
mapping = {k: OVAL[k] for k in range(n_oval)}
for k, v in enumerate(r['vertices']):
    if k >= n_oval:
        mapping[k] = len(verts)
        verts.append(tuple(v))
tris += [[mapping[a] for a in t] for t in r['triangles']]

V = np.array(verts)
N = len(V)
x, y = V[:, 0], V[:, 1]

def smoothstep(a, b, v):
    t = np.clip((v - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)

mouth_l, mouth_r = P[61], P[291]
MW = np.linalg.norm(mouth_r - mouth_l)
mc = (P[13] + P[14]) / 2
chin = P[152]
face_mask = np.array([in_poly(v, oval) for v in V]) | np.isin(np.arange(N), OVAL)
fields = {}

# Jaw: everything below the lip line drops; the cheeks beside the mouth stretch, the neck under the chin follows less.
ui, li = P[UI], P[LI]
def lip_line(xq):
    xs = (ui[:, 0] + li[:, 0]) / 2; ys = (ui[:, 1] + li[:, 1]) / 2
    o = np.argsort(xs)
    return np.interp(xq, xs[o], ys[o])
v_off = y - lip_line(x)
beyond = np.maximum(0, np.abs(x - mc[0]) - MW / 2)
below = smoothstep(-6 - 0.8 * beyond, 6 + 0.8 * beyond, v_off)
below[np.isin(np.arange(N), LI[1:-1])] = 1
below[np.isin(np.arange(N), UI[1:-1])] = 0
oval_half = np.array([max(1.0, np.interp(yy, *zip(*sorted((o[1], abs(o[0] - mc[0])) for o in oval[OVAL.index(152) - 9:OVAL.index(152) + 10])))) for yy in y])
side = np.clip(np.abs(x - mc[0]) / oval_half, 0, 1.5)
horiz = 1 - 0.75 * smoothstep(0.35, 1.0, side)
under = np.exp(-np.maximum(0, y - chin[1]) ** 2 / (2 * 45 ** 2))
r_mouth = np.linalg.norm(V - mc, axis=1)
DROP = 0.24 * MW
jaw_dy = DROP * below * horiz * under
jaw_dy -= 0.05 * MW * (1 - below) * np.exp(-r_mouth ** 2 / (2 * (0.25 * MW) ** 2))
jaw_dy[~face_mask & (y < chin[1] - 0.6 * MW)] = 0
fields['open'] = np.stack([np.zeros(N), jaw_dy], 1)

# Mouth width: the corners move out (positive) or in, carrying the lips and nearby cheeks.
near_lips = np.exp(-np.maximum(0, np.abs(v_off) - 0.08 * MW) ** 2 / (2 * (0.16 * MW) ** 2))
along = np.clip((x - mc[0]) / (MW / 2), -1, 1)
past = np.exp(-beyond ** 2 / (2 * (0.25 * MW) ** 2))
fields['width'] = np.stack([0.5 * MW * along * near_lips * past, np.zeros(N)], 1)

# Smile: corners up and out, lifting the cheeks a little.
sm = np.zeros((N, 2))
for c, s in ((mouth_l, -1), (mouth_r, 1)):
    g = np.exp(-np.sum((V - c) ** 2, 1) / (2 * (0.2 * MW) ** 2))
    sm[:, 0] += s * 0.05 * MW * g
    sm[:, 1] -= 0.09 * MW * g
fields['smile'] = sm

# Eyes: the upper lid slides down onto the lower one; the skin above stretches. The iris moves for gaze.
for side, e in EYES.items():
    up, lo = P[e['up']], P[e['lo']]
    o = np.argsort(up[:, 0])
    upY = lambda q: np.interp(q, up[o, 0], up[o, 1])
    loY = lambda q: np.interp(q, lo[np.argsort(lo[:, 0]), 0], lo[np.argsort(lo[:, 0]), 1])
    brow = P[e['brow']]
    bo = np.argsort(brow[:, 0])
    browY = lambda q: np.interp(q, brow[bo, 0], brow[bo, 1])
    x0, x1 = up[:, 0].min(), up[:, 0].max()
    xc = np.clip(x, x0, x1)
    gap = np.maximum(0, loY(xc) - upY(xc))
    ring = set(e['up'] + e['lo'])
    blink = np.zeros((N, 2))
    gaze = np.zeros(N, bool)
    for i in range(N):
        if i in e['lo'] or i in (e['up'][0], e['up'][-1]):
            continue
        out = max(0, x0 - x[i], x[i] - x1)
        fade = np.exp(-out ** 2 / (2 * 6 ** 2))
        if i in e['up'] or i in eye_iris[side]:
            s = 0 if i in e['up'] else np.clip((y[i] - upY(xc[i])) / max(gap[i], 1e-3), 0, 1)
            blink[i, 1] = gap[i] * (1 - s)
            gaze[i] = i in eye_iris[side]
        elif upY(xc[i]) - 2 * (upY(xc[i]) - browY(xc[i])) < y[i] < upY(xc[i]) and out < 18:
            # Between the lid and the brow: stretch, most at the lid.
            w = 1 - (upY(xc[i]) - y[i]) / max(1, 0.9 * (upY(xc[i]) - browY(xc[i])))
            blink[i, 1] = gap[i] * max(0, w) * fade
    fields[f'blink{side}'] = blink
    gz = np.zeros((N, 2)); gz[gaze, 0] = 1
    fields[f'gazeX{side}'] = gz
    gz = np.zeros((N, 2)); gz[gaze, 1] = 1
    fields[f'gazeY{side}'] = gz
    # Brows: raised at the inner and outer ends separately; the forehead above follows, the lid below stretches.
    inner_x = brow[:, 0].max() if side == 'L' else brow[:, 0].min()
    outer_x = brow[:, 0].min() if side == 'L' else brow[:, 0].max()
    t = np.clip((x - inner_x) / (outer_x - inner_x), 0, 1)
    bx0, bx1 = brow[:, 0].min(), brow[:, 0].max()
    out = np.maximum(0, np.maximum(bx0 - x, x - bx1))
    hfade = np.exp(-out ** 2 / (2 * 20 ** 2))
    by = browY(np.clip(x, bx0, bx1))
    ly = upY(np.clip(x, x0, x1))
    above = np.exp(-np.maximum(0, by - 8 - y) ** 2 / (2 * 55 ** 2))
    below_b = np.clip((ly - y) / np.maximum(1, ly - by - 6), 0, 1)
    vert = np.where(y < by + 6, above, below_b)
    vert[np.isin(np.arange(N), list(ring) + eye_iris[side])] = 0
    vert[np.isin(np.arange(N), e['brow'])] = 1
    w = vert * hfade
    w[~face_mask] *= (y[~face_mask] < by[~face_mask])
    fields[f'browInner{side}'] = np.stack([np.zeros(N), -w * (1 - t)], 1)
    fields[f'browOuter{side}'] = np.stack([np.zeros(N), -w * t], 1)

# Head: rotates and sways fully above the chin, fading out down the neck. Breath lifts all but the bottom edge.
head = 1 - smoothstep(chin[1] - 10, min(chin[1] + 90, H), y)  # done by the bottom edge, which stays put
breath = smoothstep(H, H - 160, y)

def sparse(f):
    nz = np.nonzero(np.abs(f).max(1) > 0.05)[0]
    return [[int(i), round(float(f[i, 0]), 2), round(float(f[i, 1]), 2)] for i in nz]

out = {
    'size': [W, H],
    'vertices': [round(float(v), 1) for v in V.ravel()],
    'triangles': [int(i) for t in tris for i in t],
    'mouth': {'upper': UI, 'lower': LI},
    'head': [round(float(h), 3) for h in head],
    'breath': [round(float(b), 3) for b in breath],
    'pivot': [round(float(chin[0]), 1), round(float(chin[1] + 30), 1)],
    'mouthWidth': round(float(MW), 1),
    'focus': [round(float(v), 1) for v in (P[10] + P[152]) / 2],
    'fields': {k: sparse(v) for k, v in fields.items()},
}
ts_out, webp_out, bg_out = sys.argv[1], sys.argv[2], sys.argv[3]
with open(ts_out, 'w') as f:
    f.write('// Generated by frontend/scripts/photo-avatar/mesh.py from a photo; do not edit by hand.\n')
    f.write("import type { PhotoMesh } from './mesh';\n\n")
    name = os.path.splitext(os.path.basename(ts_out))[0].upper() + '_PHOTO'
    f.write(f'export const {name}: PhotoMesh = {json.dumps(out, separators=(",", ":"))};\n')

# Background: fill the solid part of the subject with blurred surroundings, coarse to fine. Soft edges (flyaway hair)
# keep the original pixels, so at rest the subject over the background gives back the photo exactly.
frame = np.asarray(Image.open('frame.png').convert('RGB'), np.float32)
alpha = np.asarray(cut)[:, :, 3]
hole = alpha > 64
fill = smoothstep(64, 192, cv2.dilate(alpha, np.ones((3, 3), np.uint8)).astype(np.float32))[..., None]
known = (~hole).astype(np.float32)
plate = frame.copy()
filled = known.copy()
for sigma in (4, 8, 16, 32, 64, 128, 256):
    k = int(sigma * 3) | 1
    num = cv2.GaussianBlur(frame * known[..., None], (k, k), sigma)
    den = cv2.GaussianBlur(known, (k, k), sigma)
    ok = (den > 0.05) & (filled == 0)
    plate[ok] = num[ok] / den[ok, None]
    filled[ok] = 1
plate = fill * cv2.GaussianBlur(plate, (0, 0), 3) + (1 - fill) * frame
plate = np.clip(plate, 0, 255)
Image.fromarray(plate.astype(np.uint8)).save(bg_out, quality=70, method=6)
# Recolour semi-transparent subject pixels so that, at rest, subject over background is the photo again.
a = alpha.astype(np.float32)[..., None] / 255
soft = (alpha > 0) & (alpha < 255)
rgb = np.asarray(cut, np.float32)[:, :, :3].copy()
rgb[soft] = ((frame - (1 - a) * plate) / np.maximum(a, 0.02))[soft]
cut = Image.fromarray(np.dstack([np.clip(rgb, 0, 255), alpha]).astype(np.uint8), 'RGBA')
cut.save(webp_out, quality=82, method=6)
print('vertices', N, 'triangles', len(tris), 'mouth width', round(MW, 1), 'ts', os.path.getsize(ts_out),
      'webp', os.path.getsize(webp_out), 'background', os.path.getsize(bg_out), {k: len(v) for k, v in out['fields'].items()})
