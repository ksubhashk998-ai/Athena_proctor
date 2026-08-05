"""
YOLOv8 Detection Microservice
Run with: uvicorn main:app --host 0.0.0.0 --port 8001
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import io
import numpy as np
from PIL import Image
import logging

# Try importing ultralytics; graceful fallback if not installed
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    logging.warning("ultralytics not installed. Run: pip install ultralytics")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="YOLOv8 Detection Microservice",
    description="Phone and Headphone/Earphone detection for Smart Proctoring",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# COCO class IDs relevant to proctoring
# 67 = cell phone
PHONE_CLASS_ID = 67

# Earphone/headphone not natively in COCO-80, we use proxy classes
# and custom keyword matching on detected labels
HEADPHONE_KEYWORDS = ["earphone", "headphone", "earbud", "airpod", "headset"]

# Load YOLOv8 models (lazy, on first request)
_phone_model = None
_headphone_model = None

def get_phone_model():
    global _phone_model
    if _phone_model is None and YOLO_AVAILABLE:
        try:
            _phone_model = YOLO("yolov8n.pt")  # Downloads automatically on first run
            logger.info("YOLOv8n loaded for phone detection")
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
    return _phone_model

def get_headphone_model():
    global _headphone_model
    if _headphone_model is None and YOLO_AVAILABLE:
        try:
            # Try custom model first, fall back to general
            import os
            custom_path = "models/headphone_yolov8.pt"
            if os.path.exists(custom_path):
                _headphone_model = YOLO(custom_path)
                logger.info("Custom headphone model loaded")
            else:
                _headphone_model = YOLO("yolov8n.pt")  # fallback
                logger.info("Using YOLOv8n for headphone detection (general model)")
        except Exception as e:
            logger.error(f"Failed to load headphone model: {e}")
    return _headphone_model


class DetectionRequest(BaseModel):
    imageBase64: str  # data:image/jpeg;base64,... or raw base64
    confidence_threshold: float = 0.35


class Detection(BaseModel):
    label: str
    confidence: float
    bbox: list  # [x1, y1, x2, y2]
    class_id: int = -1


class DetectionResponse(BaseModel):
    detected: bool
    detections: list
    model: str
    yolo_available: bool


def decode_image(imageBase64: str) -> Image.Image:
    """Decode base64 image string to PIL Image"""
    if "," in imageBase64:
        imageBase64 = imageBase64.split(",")[1]
    image_bytes = base64.b64decode(imageBase64)
    return Image.open(io.BytesIO(image_bytes)).convert("RGB")


def run_yolo_detection(model, image: Image.Image, target_class_ids: list, threshold: float):
    """Run YOLO detection and filter by target class IDs"""
    if model is None:
        return []
    
    img_array = np.array(image)
    results = model(img_array, verbose=False)[0]
    
    detections = []
    for box in results.boxes:
        cls_id = int(box.cls[0])
        conf = float(box.conf[0])
        if conf < threshold:
            continue
        if cls_id in target_class_ids or target_class_ids == [-1]:
            x1, y1, x2, y2 = box.xyxy[0].tolist()
            label = results.names[cls_id]
            detections.append({
                "label": label,
                "confidence": round(conf, 4),
                "bbox": [round(x1), round(y1), round(x2), round(y2)],
                "class_id": cls_id
            })
    return detections


@app.get("/health")
async def health_check():
    return {
        "status": "ok",
        "yolo_available": YOLO_AVAILABLE,
        "message": "YOLOv8 Detection Service Running"
    }


@app.post("/detect/phone", response_model=DetectionResponse)
async def detect_phone(request: DetectionRequest):
    """Detect mobile phones in the image"""
    try:
        image = decode_image(request.imageBase64)
        
        if not YOLO_AVAILABLE:
            # Fallback: return empty (Node backend uses COCO-SSD)
            return DetectionResponse(
                detected=False,
                detections=[],
                model="fallback_none",
                yolo_available=False
            )
        
        model = get_phone_model()
        detections = run_yolo_detection(
            model, image,
            target_class_ids=[PHONE_CLASS_ID],  # 67 = cell phone in COCO
            threshold=request.confidence_threshold
        )
        
        return DetectionResponse(
            detected=len(detections) > 0,
            detections=detections,
            model="yolov8n",
            yolo_available=True
        )
    except Exception as e:
        logger.error(f"Phone detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/detect/headphone", response_model=DetectionResponse)
async def detect_headphone(request: DetectionRequest):
    """Detect headphones, earbuds, AirPods etc. in the image"""
    try:
        image = decode_image(request.imageBase64)
        
        if not YOLO_AVAILABLE:
            return DetectionResponse(
                detected=False,
                detections=[],
                model="fallback_none",
                yolo_available=False
            )
        
        model = get_headphone_model()
        
        # Run full detection (class_id -1 = all) and filter by label keywords
        # since standard COCO doesn't have headphone class
        all_detections = run_yolo_detection(
            model, image,
            target_class_ids=list(range(80)),  # all COCO classes
            threshold=request.confidence_threshold
        )
        
        # Filter by headphone-related labels
        headphone_detections = [
            d for d in all_detections
            if any(kw in d["label"].lower() for kw in HEADPHONE_KEYWORDS)
        ]
        
        # If no specific headphone class found, check for class 85+ (custom model)
        # or use a heuristic: any object near ear region
        if not headphone_detections and all_detections:
            # Try to identify potential headphone objects near head area
            img_w, img_h = image.size
            for d in all_detections:
                x1, y1, x2, y2 = d["bbox"]
                # Objects in upper portion of frame, relatively small
                if y2 < img_h * 0.6 and (x2 - x1) < img_w * 0.3:
                    if d["label"] in ["remote", "keyboard", "mouse"]:
                        continue  # Skip obvious false positives
                    # Could be headphone - low confidence heuristic
                    headphone_detections.append({**d, "label": "possible_earpiece", "confidence": d["confidence"] * 0.6})
        
        return DetectionResponse(
            detected=len(headphone_detections) > 0,
            detections=headphone_detections,
            model="yolov8n_headphone",
            yolo_available=True
        )
    except Exception as e:
        logger.error(f"Headphone detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=False)
