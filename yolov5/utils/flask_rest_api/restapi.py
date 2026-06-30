# YOLOv5 🚀 by Ultralytics, GPL-3.0 license
"""
Run a Flask REST API exposing a YOLOv5s model
"""

import argparse
import io
from pathlib import Path

import torch
from flask import Flask, request
from PIL import Image

app = Flask(__name__)

DETECTION_URL = "/v1/object-detection/yolov5s"


@app.route(DETECTION_URL, methods=["POST"])
def predict():
    if request.method != "POST":
        return

    if request.files.get("image"):
        # Method 1
        # with request.files["image"] as f:
        #     im = Image.open(io.BytesIO(f.read()))

        # Method 2
        im_file = request.files["image"]
        im_bytes = im_file.read()
        im = Image.open(io.BytesIO(im_bytes))

        results = model(im, size=640)  # reduce size=320 for faster inference
        return results.pandas().xyxy[0].to_json(orient="records")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Flask API exposing YOLOv5 model")
    parser.add_argument("--port", default=5000, type=int, help="port number")
    opt = parser.parse_args()

    repo_root = Path(__file__).resolve().parents[2]  # yolov5 project root

    # Load the local YOLOv5 model from this workspace instead of downloading from the hub.
    model = torch.hub.load(str(repo_root), 'custom', path=str(repo_root / 'best.pt'), source='local', force_reload=True)
    app.run(host="0.0.0.0", port=opt.port)  # debug=True causes Restarting with stat
