# Photo avatar

Turns a photo into an animated photo avatar (`<name>` is `male` or `female`):

- `frontend/public/avatars/<name>.webp`: the person, cut out, drawn on the mesh;
- `frontend/public/avatars/<name>-bg.webp`: the background with the person filled in, drawn still behind them, so the
  head can move without showing a ghost of itself. At rest the two give back the photo exactly;
- `frontend/lib/photo/<name>.ts`: the deformable mesh, exported as `<NAME>_PHOTO`.

The mesh is MediaPipe's face tessellation (with the mouth cut open and the eyes re-meshed around the iris) plus a grid
for the hair, neck and shirt. For each control — jaw, mouth width, smile, blinks, gaze and brows — the script stores
how far each vertex moves; the browser blends these per frame and draws the inside of the mouth behind the opening.
The browser crops the photo to fill the avatar panel, keeping the face centred.

```sh
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
mkdir work && cp /path/to/photo.png work/photo.png && cd work
# crop box x y w h around the face (optional); cut-out and face landmarks; downloads the model on first run
../.venv/bin/python ../prepare.py 460 10 660 460
../.venv/bin/python ../mesh.py ../../../lib/photo/male.ts ../../../public/avatars/male.webp ../../../public/avatars/male-bg.webp
```

Works best with an evenly lit, front-facing photo with a closed, relaxed mouth. Crop around the head and collar with a
little room above the hair, at about 1.4:1. The current crops are `460 10 660 460` (male) and `615 0 500 360` (female)
from 1568×882 photos.
