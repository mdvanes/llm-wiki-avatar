"""Step 1: crops photo.png to frame.png, cuts the subject out and finds the face landmarks (in the current directory).

Usage: prepare.py [x y w h]  (optional crop box in photo px; default: the whole photo)
"""
import json, os, sys, urllib.request
import mediapipe as mp
from mediapipe.tasks.python import BaseOptions, vision
from PIL import Image
from rembg import new_session, remove

MODELS = {
    'face_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
}
for name, url in MODELS.items():
    if not os.path.exists(name):
        urllib.request.urlretrieve(url, name)

photo = Image.open('photo.png').convert('RGB')
if len(sys.argv) == 5:
    x, y, w, h = map(int, sys.argv[1:])
    photo = photo.crop((x, y, x + w, y + h))
photo.save('frame.png')
remove(photo, session=new_session('isnet-general-use')).save('cut.png')

w, h = photo.size
opts = vision.FaceLandmarkerOptions(
    base_options=BaseOptions(model_asset_path='face_landmarker.task', delegate=BaseOptions.Delegate.CPU), num_faces=1)
with vision.FaceLandmarker.create_from_options(opts) as lm:
    res = lm.detect(mp.Image.create_from_file('frame.png'))
json.dump([(p.x * w, p.y * h) for p in res.face_landmarks[0]], open('landmarks.json', 'w'))

print('prepared frame.png, cut.png, landmarks.json')
