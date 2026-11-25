"""Independently decode the app's QR codes with OpenCV.

    node scripts/qr-samples.ts > /tmp/qr.json && python docs/verify-qr.py /tmp/qr.json
"""
import json, sys
import cv2, numpy as np

data = json.load(open(sys.argv[1]))
detector = cv2.QRCodeDetector()
ok = 0
for d in data:
    m = np.array(d["m"], dtype=np.uint8)
    img = np.pad((1 - m) * 255, 4, constant_values=255).astype(np.uint8)
    img = cv2.resize(img, None, fx=10, fy=10, interpolation=cv2.INTER_NEAREST)
    text, _, _ = detector.detectAndDecode(img)
    ok += text == d["s"]
    print(("OK  " if text == d["s"] else "FAIL"), f"version {(m.shape[0] - 17) // 4}", repr(d["s"][:40]))
print(f"{ok}/{len(data)} decoded")
sys.exit(0 if ok == len(data) else 1)
