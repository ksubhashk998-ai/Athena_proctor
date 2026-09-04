"""
InsightFace ArcFace & YOLOv8 Biometric Microservice
Optimized for 512 MB RAM / CPU-only Cloud Deployment (Render)
Run locally: uvicorn main:app --host 127.0.0.1 --port 8001
Run on Render: uvicorn main:app --host 0.0.0.0 --port $PORT
"""
import base64
import gc
import io
import logging
import os
import time
from typing import Any, List, Optional

import cv2
import numpy as np
from PIL import Image

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("detector")

# ML Dependency Checks & Global Lazy Instances
YOLO_AVAILABLE = False
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    logger.warning("ultralytics not installed. Run: pip install ultralytics")

INSIGHTFACE_AVAILABLE = False
try:
    import insightface
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
except ImportError:
    logger.warning("insightface not installed. Run: pip install insightface onnxruntime")

# Lazy model references (Initialized on-demand only)
_insightface_app = None
_phone_model = None
_headphone_model = None

# COCO class IDs (0 = person, 67 = cell phone)
PERSON_CLASS_ID = 0
PHONE_CLASS_ID = 67
HEADPHONE_KEYWORDS = ["earphone", "headphone", "earbud", "airpod", "headset"]

# Quality & Verification Constants
MIN_ACCEPTABLE_QUALITY = 45.0
GOOD_QUALITY = 60.0
MIN_VALID_EMBEDDINGS = 20
MAX_CANDIDATE_FRAMES = 40
MIN_VERIFICATION_FRAMES = 2
SIMILARITY_THRESHOLD = 0.65
SUSPICIOUS_THRESHOLD = 0.65
VERIFIED_THRESHOLD = 0.65
TARGET_VERIFICATION_FRAMES = 8
ENABLE_DIAGNOSTIC_MODE = True

app = FastAPI(
    title="InsightFace ArcFace & YOLOv8 Microservice",
    description="ArcFace Biometric Verification & Object Detection for Smart Proctoring (512MB RAM Optimized)",
    version="2.1.0"
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"422 Validation Error on {request.url.path}: {exc.errors()}")
    return JSONResponse(status_code=422, content={"detail": exc.errors()})

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ----------------- LAZY MODEL LOADERS (CPU ONLY) -----------------

def get_insightface():
    """
    Lazy-load InsightFace buffalo_s ArcFace Model (512-d embeddings).
    Uses lightweight buffalo_s (~40MB RAM) on CPU execution provider.
    """
    global _insightface_app
    if _insightface_app is not None:
        return _insightface_app
    if INSIGHTFACE_AVAILABLE:
        try:
            logger.info("🔄 Lazy-loading InsightFace ArcFace model (buffalo_s - CPU)...")
            app_face = FaceAnalysis(
                name='buffalo_s',
                allowed_modules=['detection', 'recognition'],
                providers=['CPUExecutionProvider']
            )
            app_face.prepare(ctx_id=-1, det_size=(320, 320))
            _insightface_app = app_face
            logger.info("✅ ArcFace model loaded (InsightFace buffalo_s - 512d ArcFace - Fast CPU Mode)")
        except Exception as e:
            logger.error(f"❌ Failed to load InsightFace ArcFace model: {e}")
    return _insightface_app

def get_phone_model():
    """Lazy-load YOLOv8n nano model (~6MB) for phone detection on CPU"""
    global _phone_model
    if _phone_model is None and YOLO_AVAILABLE:
        try:
            logger.info("🔄 Lazy-loading YOLOv8n phone model (CPU)...")
            _phone_model = YOLO("yolov8n.pt")
            logger.info("✅ YOLOv8n loaded for phone detection")
        except Exception as e:
            logger.error(f"❌ Failed to load YOLO phone model: {e}")
    return _phone_model

def get_headphone_model():
    """Lazy-load YOLOv8n for headphone detection on CPU"""
    global _headphone_model
    if _headphone_model is None and YOLO_AVAILABLE:
        try:
            custom_path = "models/headphone_yolov8.pt"
            if os.path.exists(custom_path):
                _headphone_model = YOLO(custom_path)
            else:
                _headphone_model = YOLO("yolov8n.pt")
            logger.info("✅ YOLOv8 loaded for headphone detection")
        except Exception as e:
            logger.error(f"❌ Failed to load YOLO headphone model: {e}")
    return _headphone_model

# ----------------- REQUEST & RESPONSE SCHEMAS -----------------

class DetectionRequest(BaseModel):
    imageBase64: str
    confidence_threshold: float = 0.35

class DetectionResponse(BaseModel):
    detected: bool
    detections: list
    model: str
    yolo_available: bool

class ArcFaceEnrollRequest(BaseModel):
    studentId: Optional[str] = ""
    name: Optional[str] = ""
    email: Optional[str] = ""
    frames: List[Any] = []

class ArcFaceVerifyRequest(BaseModel):
    studentId: Optional[str] = ""
    email: Optional[str] = ""
    frames: Optional[List[Any]] = []
    enrolledEmbeddings: Optional[List[List[float]]] = []
    averageEmbedding: Optional[List[float]] = []
    challengePose: Optional[str] = None
    embedding: Optional[List[float]] = []
    liveEmbeddings: Optional[List[List[float]]] = []

# ----------------- MEMORY-EFFICIENT UTILITIES -----------------

def preprocess_image_np(imageBase64: str, target_max_dim: int = 640) -> Optional[np.ndarray]:
    """
    Decodes Base64 string directly to BGR numpy array and resizes to target_max_dim.
    Avoids retaining duplicate image buffers.
    """
    if not imageBase64:
        return None
    try:
        if "," in imageBase64:
            imageBase64 = imageBase64.split(",", 1)[1]
        image_bytes = base64.b64decode(imageBase64)
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        rgb_arr = np.array(pil_img)
        bgr_img = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)

        h, w = bgr_img.shape[:2]
        if max(h, w) > target_max_dim:
            scale = target_max_dim / float(max(h, w))
            new_w = max(1, int(round(w * scale)))
            new_h = max(1, int(round(h * scale)))
            bgr_img = cv2.resize(bgr_img, (new_w, new_h), interpolation=cv2.INTER_AREA)

        return bgr_img
    except Exception as err:
        logger.error(f"Image preprocessing error: {err}")
        return None

def normalize_l2(vec: Any) -> list:
    """Normalize vector to L2 unit length (512-dim ArcFace embedding)"""
    arr = np.array(vec, dtype=np.float32)
    norm = np.linalg.norm(arr)
    if norm == 0 or np.isnan(norm):
        return arr.tolist()
    return (arr / norm).tolist()

def cosine_similarity(v1: list, v2: list) -> float:
    """Compute Cosine Similarity between two L2-normalized 512d embeddings"""
    a = np.array(v1, dtype=np.float32)
    b = np.array(v2, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    sim = np.dot(a, b) / (norm_a * norm_b)
    return float(np.clip(sim, 0.0, 1.0))

def compute_iou(box1, box2):
    """Compute Intersection-over-Union between two bounding boxes"""
    x1 = max(float(box1[0]), float(box2[0]))
    y1 = max(float(box1[1]), float(box2[1]))
    x2 = min(float(box1[2]), float(box2[2]))
    y2 = min(float(box1[3]), float(box2[3]))

    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    area1 = max(0.0, float(box1[2]) - float(box1[0])) * max(0.0, float(box1[3]) - float(box1[1]))
    area2 = max(0.0, float(box2[2]) - float(box2[0])) * max(0.0, float(box2[3]) - float(box2[1]))

    union = area1 + area2 - intersection
    if union <= 0.0:
        return 0.0
    return float(intersection / union)

def filter_real_faces(raw_faces, img_shape, min_conf=0.45, min_size=30):
    """
    Filter raw InsightFace detections to distinct real faces:
    - Filters low-confidence artifacts
    - Filters tiny background noise
    - Deduplicates overlapping boxes on the same face (IoU >= 0.40)
    """
    if not raw_faces:
        return []

    candidates = []
    for face in raw_faces:
        bbox = face.bbox.astype(int) if hasattr(face.bbox, 'astype') else [int(b) for b in face.bbox]
        x1, y1, x2, y2 = bbox
        w, h = max(0, x2 - x1), max(0, y2 - y1)
        conf = float(getattr(face, 'det_score', 1.0) or 1.0)

        if conf >= min_conf and w >= min_size and h >= min_size:
            candidates.append(face)

    if len(candidates) <= 1:
        return candidates

    candidates.sort(key=lambda f: float(getattr(f, 'det_score', 1.0) or 1.0), reverse=True)

    kept_faces = []
    for cand in candidates:
        cand_bbox = cand.bbox
        is_duplicate = False
        for kept in kept_faces:
            if compute_iou(cand_bbox, kept.bbox) >= 0.40:
                is_duplicate = True
                break
        if not is_duplicate:
            kept_faces.append(cand)

    return kept_faces

def validate_face_quality(bgr_img: np.ndarray, face) -> dict:
    """
    Validate face sample quality:
    - Min face resolution: 100x100
    - Brightness range: 35.0-230.0
    - Blur (Laplacian Variance): >= 20.0
    """
    bbox = face.bbox.astype(int) if hasattr(face.bbox, 'astype') else [int(b) for b in face.bbox]
    x1, y1, x2, y2 = max(0, bbox[0]), max(0, bbox[1]), min(bgr_img.shape[1], bbox[2]), min(bgr_img.shape[0], bbox[3])
    face_w, face_h = x2 - x1, y2 - y1
    img_h, img_w = bgr_img.shape[:2]

    if face_w <= 0 or face_h <= 0:
        return {"passed": False, "score": 0, "reason": "Invalid face region"}

    face_crop = bgr_img[y1:y2, x1:x2]
    if face_crop.size == 0:
        return {"passed": False, "score": 0, "reason": "Invalid face region"}

    gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)

    # 1. Resolution Check
    res_score = min(100.0, (face_w * face_h / (180.0 * 180.0)) * 100.0)

    # 2. Brightness Check
    mean_brightness = float(np.mean(gray_crop))
    brightness_pass = 35.0 <= mean_brightness <= 230.0
    brightness_score = 100.0 if brightness_pass else max(0.0, 100.0 - abs(mean_brightness - 130.0))

    # 3. Blur Check (Laplacian Variance)
    blur_var = float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())
    blur_pass = blur_var >= 20.0
    blur_score = min(100.0, (blur_var / 40.0) * 100.0)

    # 4. Centering Check
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    center_dist = np.sqrt(((cx - img_w / 2.0) / (img_w / 2.0)) ** 2 + ((cy - img_h / 2.0) / (img_h / 2.0)) ** 2)
    centering_pass = center_dist <= 0.6
    centering_score = max(0.0, 100.0 * (1.0 - center_dist))

    overall_score = round(0.3 * res_score + 0.3 * blur_score + 0.2 * brightness_score + 0.2 * centering_score, 2)
    passed = overall_score >= MIN_ACCEPTABLE_QUALITY
    quality_label = "GOOD" if overall_score >= GOOD_QUALITY else ("ACCEPTABLE" if passed else "POOR")

    return {
        "passed": passed,
        "score": overall_score,
        "label": quality_label,
        "resolution": f"{face_w}x{face_h}",
        "brightness": round(mean_brightness, 1),
        "blurVar": round(blur_var, 1),
        "centered": centering_pass,
        "face_w": face_w,
        "face_h": face_h,
        "reason": quality_label if passed else f"Low quality (Res:{face_w}x{face_h}, Blur:{round(blur_var,1)}, Bright:{round(mean_brightness,1)})"
    }

def run_yolo_detection(model, image: Image.Image, target_class_ids: list, threshold: float):
    if model is None:
        return []
    img_array = np.array(image)
    # Force CPU inference and avoid unnecessary gradients/memory
    results = model(img_array, verbose=False, device="cpu")[0]
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

# ----------------- API ENDPOINTS -----------------

@app.get("/health")
async def health_check():
    """
    Lightweight health check.
    Does NOT force model loading at startup.
    """
    return {
        "status": "ok",
        "arcface_loaded": _insightface_app is not None,
        "insightface_available": INSIGHTFACE_AVAILABLE,
        "yolo_available": YOLO_AVAILABLE,
        "engine": "InsightFace-ArcFace (buffalo_s 512d CPU)"
    }

@app.post("/detect/phone", response_model=DetectionResponse)
async def detect_phone(request: DetectionRequest):
    try:
        if not YOLO_AVAILABLE:
            return DetectionResponse(detected=False, detections=[], model="fallback_none", yolo_available=False)

        if "," in request.imageBase64:
            base64_str = request.imageBase64.split(",", 1)[1]
        else:
            base64_str = request.imageBase64

        image_bytes = base64.b64decode(base64_str)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Resize image for fast, memory-safe inference
        image.thumbnail((640, 640))

        model = get_phone_model()
        detections = run_yolo_detection(model, image, target_class_ids=[PHONE_CLASS_ID], threshold=request.confidence_threshold)
        return DetectionResponse(detected=len(detections) > 0, detections=detections, model="yolov8n", yolo_available=True)
    except Exception as e:
        logger.error(f"Phone detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect/headphone", response_model=DetectionResponse)
async def detect_headphone(request: DetectionRequest):
    try:
        if not YOLO_AVAILABLE:
            return DetectionResponse(detected=False, detections=[], model="fallback_none", yolo_available=False)

        if "," in request.imageBase64:
            base64_str = request.imageBase64.split(",", 1)[1]
        else:
            base64_str = request.imageBase64

        image_bytes = base64.b64decode(base64_str)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        image.thumbnail((640, 640))

        model = get_headphone_model()
        all_detections = run_yolo_detection(model, image, target_class_ids=list(range(80)), threshold=request.confidence_threshold)
        headphone_detections = [d for d in all_detections if any(kw in d["label"].lower() for kw in HEADPHONE_KEYWORDS)]
        return DetectionResponse(detected=len(headphone_detections) > 0, detections=headphone_detections, model="yolov8n_headphone", yolo_available=True)
    except Exception as e:
        logger.error(f"Headphone detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect/faces")
async def detect_faces(request: DetectionRequest):
    """
    Real-time multi-face detection using InsightFace buffalo_s.
    """
    try:
        bgr_img = preprocess_image_np(request.imageBase64, target_max_dim=640)
        if bgr_img is None or bgr_img.size == 0:
            return {"faceCount": 0, "multipleFaces": False, "faces": []}

        app_face = get_insightface()
        if app_face is None:
            return {"faceCount": 0, "multipleFaces": False, "faces": []}

        raw_faces = app_face.get(bgr_img)
        faces = filter_real_faces(raw_faces, bgr_img.shape, min_conf=0.45, min_size=30)
        face_list = []
        for f in faces:
            bbox = [round(float(c), 1) for c in f.bbox]
            score = round(float(getattr(f, 'det_score', 1.0) or 1.0), 4)
            face_list.append({"bbox": bbox, "confidence": score})

        # Explicit cleanup of image array
        del bgr_img
        del raw_faces

        return {
            "faceCount": len(faces),
            "multipleFaces": len(faces) >= 2,
            "faces": face_list,
            "status": "multiple_faces_detected" if len(faces) >= 2 else ("single_face" if len(faces) == 1 else "no_face")
        }
    except Exception as e:
        logger.error(f"Multi-face detection error: {e}")
        return {"faceCount": 0, "multipleFaces": False, "faces": [], "error": str(e)}

@app.post("/api/arcface/enroll")
def arcface_enroll(request: ArcFaceEnrollRequest):
    """
    Enroll student with InsightFace ArcFace (buffalo_s 512-d):
    - Processes candidate frames one-by-one to conserve RAM
    - Filters frames with quality >= MIN_ACCEPTABLE_QUALITY (45%)
    - Validates 512-d embeddings
    - Returns top 20 embeddings and normalized average embedding
    """
    logger.info(f"🔄 Processing InsightFace ArcFace Enrollment for student: {request.studentId} ({len(request.frames)} frames)")

    app_face = get_insightface()
    if app_face is None:
        raise HTTPException(status_code=503, detail="InsightFace ArcFace engine not available.")

    start = time.time()
    candidates = []
    rejected_reasons = []

    frames_to_evaluate = request.frames[:MAX_CANDIDATE_FRAMES]

    for idx, b64_frame in enumerate(frames_to_evaluate):
        bgr_img = None
        try:
            bgr_img = preprocess_image_np(b64_frame, target_max_dim=640)
            if bgr_img is None or bgr_img.size == 0:
                rejected_reasons.append(f"Frame {idx+1}: Empty frame")
                continue

            raw_faces = app_face.get(bgr_img)
            faces = filter_real_faces(raw_faces, bgr_img.shape, min_conf=0.50, min_size=40)

            if len(faces) == 0:
                rejected_reasons.append(f"Frame {idx+1}: No face detected")
                continue
            if len(faces) > 1:
                logger.warning(f"🚨 [ArcFace Enrollment] Multiple faces in frame {idx+1}")
                return {
                    "success": False,
                    "error": f"Multiple faces detected during enrollment in frame {idx+1}. Please ensure only one person is in front of the camera.",
                    "validSamples": 0,
                    "totalSubmitted": len(request.frames),
                    "rejectedReasons": [f"Multiple faces detected ({len(faces)} faces in frame {idx+1})"]
                }

            face = faces[0]
            quality = validate_face_quality(bgr_img, face)

            if not quality["passed"]:
                rejected_reasons.append(f"Frame {idx+1}: {quality['reason']}")
                continue

            raw_emb = getattr(face, 'normed_embedding', None)
            if raw_emb is None:
                raw_emb = getattr(face, 'embedding', None)

            if raw_emb is None or raw_emb.shape[0] != 512:
                rejected_reasons.append(f"Frame {idx+1}: Invalid embedding dimension")
                continue
            if np.any(np.isnan(raw_emb)) or np.any(np.isinf(raw_emb)):
                rejected_reasons.append(f"Frame {idx+1}: Invalid embedding values")
                continue

            det_score = float(getattr(face, 'det_score', 1.0) or 1.0)
            composite_score = round(det_score * 30.0 + quality["score"] * 0.7, 2)

            candidates.append({
                "score": composite_score,
                "quality_score": quality["score"],
                "embedding": raw_emb.copy(),
                "frame_idx": idx + 1
            })

        except Exception as err:
            rejected_reasons.append(f"Frame {idx+1}: Processing error {str(err)}")
        finally:
            if bgr_img is not None:
                del bgr_img

    # Select top MIN_VALID_EMBEDDINGS (20) highest-quality samples
    candidates.sort(key=lambda x: x["score"], reverse=True)
    top_candidates = candidates[:MIN_VALID_EMBEDDINGS]

    embeddings = [normalize_l2(c["embedding"]) for c in top_candidates]
    quality_scores = [c["quality_score"] for c in top_candidates]
    valid_count = len(embeddings)

    avg_q = round(float(np.mean(quality_scores)), 2) if quality_scores else 0.0

    logger.info(f"[ArcFace] Valid samples: {valid_count}/{len(request.frames)} for {request.studentId}")

    # Garbage collection after batch processing
    del candidates
    del top_candidates
    gc.collect()

    if valid_count < 5:
        return {
            "success": False,
            "error": f"Enrollment needs better lighting. Please move closer to a light source, center your face, and try again. (Gathered {valid_count}/5 samples)",
            "validSamples": valid_count,
            "totalSubmitted": len(request.frames),
            "rejectedReasons": rejected_reasons[:10]
        }

    emb_matrix = np.array(embeddings, dtype=np.float32)
    mean_vec = np.mean(emb_matrix, axis=0)
    average_embedding = normalize_l2(mean_vec)

    return {
        "success": True,
        "message": f"Enrollment successful — {valid_count} high-quality face samples captured.",
        "embeddings": embeddings,
        "averageEmbedding": average_embedding,
        "validSamples": valid_count,
        "totalSubmitted": len(request.frames),
        "averageQualityScore": avg_q,
        "modelVersion": "InsightFace-ArcFace (buffalo_s 512d CPU)"
    }

@app.post("/api/arcface/verify")
def arcface_verify(request: ArcFaceVerifyRequest):
    """
    InsightFace ArcFace Biometric Identity Verification:
    - Evaluates similarity score against enrolled 512-d embeddings
    - Verification succeeds if averageSimilarity >= 0.65 or bestSimilarity >= 0.70
    """
    verification_start = time.time()

    input_items = []
    if request.frames and len(request.frames) > 0:
        input_items = request.frames
    elif request.liveEmbeddings and len(request.liveEmbeddings) > 0:
        input_items = request.liveEmbeddings
    elif request.embedding and len(request.embedding) == 512:
        input_items = [request.embedding]

    frames_to_process = input_items[:TARGET_VERIFICATION_FRAMES]
    total_requested = len(frames_to_process)

    if total_requested == 0:
        return {
            "success": False,
            "verified": False,
            "match": False,
            "result": "rejected",
            "finalDecision": "REJECTED",
            "message": "No verification frames or embeddings provided",
            "bestSimilarity": 0.0,
            "averageSimilarity": 0.0,
            "verifiedFrames": 0,
            "totalFramesProcessed": 0
        }

    app_face = get_insightface()
    if app_face is None:
        raise HTTPException(status_code=503, detail="InsightFace ArcFace engine unavailable")

    if not request.enrolledEmbeddings or len(request.enrolledEmbeddings) == 0:
        return {
            "success": False,
            "verified": False,
            "match": False,
            "needsEnrollment": True,
            "result": "rejected",
            "finalDecision": "REJECTED",
            "message": "Enrollment data missing",
            "error": "Enrollment data missing. Please complete face enrollment first.",
            "bestSimilarity": 0.0,
            "averageSimilarity": 0.0
        }

    for enrolled in request.enrolledEmbeddings:
        if not isinstance(enrolled, list) or len(enrolled) != 512:
            raise HTTPException(status_code=400, detail="Invalid enrolled embedding dimension. Expected 512d.")

    # Pre-compute L2 normalized enrolled matrix ONCE
    enrolled_matrix = np.asarray(request.enrolledEmbeddings, dtype=np.float32)
    norms = np.linalg.norm(enrolled_matrix, axis=1, keepdims=True)
    enrolled_matrix = enrolled_matrix / np.maximum(norms, 1e-8)

    average_vector = None
    if request.averageEmbedding and len(request.averageEmbedding) == 512:
        average_vector = np.asarray(request.averageEmbedding, dtype=np.float32)
        norm_avg = np.linalg.norm(average_vector)
        if norm_avg > 0:
            average_vector = average_vector / norm_avg

    verified_count = 0
    suspicious_count = 0
    rejected_count = 0
    multi_face_triggered = False
    frame_similarities = []
    quality_scores = []

    for idx, item in enumerate(frames_to_process):
        bgr_img = None
        try:
            live_vector = None
            if isinstance(item, list) or isinstance(item, np.ndarray):
                raw_arr = np.asarray(item, dtype=np.float32)
                if raw_arr.shape[0] == 512:
                    live_vector = raw_arr / max(np.linalg.norm(raw_arr), 1e-8)
            elif isinstance(item, str) and len(item) > 100:
                bgr_img = preprocess_image_np(item, target_max_dim=640)
                if bgr_img is not None and bgr_img.size > 0:
                    raw_faces = app_face.get(bgr_img)
                    faces = filter_real_faces(raw_faces, bgr_img.shape, min_conf=0.50, min_size=40)

                    if len(faces) == 0:
                        rejected_count += 1
                        continue

                    if len(faces) > 1:
                        logger.warning(f"🚨 [ArcFace Verification] Multiple faces in frame {idx+1}")
                        multi_face_triggered = True
                        rejected_count += 1
                        continue

                    face = faces[0]
                    quality = validate_face_quality(bgr_img, face)
                    quality_scores.append(quality["score"])

                    raw_live_emb = getattr(face, 'normed_embedding', None)
                    if raw_live_emb is None:
                        raw_live_emb = getattr(face, 'embedding', None)
                    if raw_live_emb is not None and raw_live_emb.shape[0] == 512:
                        live_vector = np.asarray(raw_live_emb, dtype=np.float32)
                        live_vector = live_vector / max(np.linalg.norm(live_vector), 1e-8)

            if live_vector is None:
                rejected_count += 1
                continue

            similarities = np.dot(enrolled_matrix, live_vector)
            best_sim = float(np.max(similarities))

            if average_vector is not None:
                sim_to_avg = float(np.dot(average_vector, live_vector))
                best_sim = float(max(best_sim, sim_to_avg))

            best_sim_clamped = round(float(np.clip(best_sim, 0.0, 1.0)), 4)
            frame_similarities.append(best_sim_clamped)

            if best_sim_clamped >= VERIFIED_THRESHOLD:
                verified_count += 1
            elif best_sim_clamped >= SUSPICIOUS_THRESHOLD:
                suspicious_count += 1
            else:
                rejected_count += 1

            if len(frame_similarities) >= 5:
                current_avg = float(np.mean(frame_similarities))
                if current_avg >= 0.68:
                    break

        except Exception as err:
            logger.error(f"Error processing frame {idx+1}: {err}")
            rejected_count += 1
        finally:
            if bgr_img is not None:
                del bgr_img

    valid_count = len(frame_similarities)
    best_similarity = round(float(np.max(frame_similarities)), 4) if frame_similarities else 0.0
    average_similarity = round(float(np.mean(frame_similarities)), 4) if frame_similarities else 0.0
    avg_quality = round(float(np.mean(quality_scores)), 2) if quality_scores else 0.0
    total_elapsed = round(time.time() - verification_start, 2)

    # Garbage collection
    gc.collect()

    if valid_count < MIN_VERIFICATION_FRAMES:
        return {
            "success": True,
            "verified": False,
            "match": False,
            "decision": "INSUFFICIENT_SAMPLES",
            "finalDecision": "INSUFFICIENT_SAMPLES",
            "result": "insufficient_samples",
            "message": f"Only {valid_count} valid face frames received. At least {MIN_VERIFICATION_FRAMES} are required.",
            "bestSimilarity": best_similarity,
            "averageSimilarity": average_similarity,
            "validFrames": valid_count,
            "totalFrames": total_requested,
            "totalFramesProcessed": total_requested,
            "elapsedSeconds": total_elapsed
        }

    if multi_face_triggered and valid_count < 3:
        decision = "MULTIPLE_FACES_DETECTED"
        verified = False
    elif average_similarity >= SIMILARITY_THRESHOLD or best_similarity >= 0.70:
        verified = True
        decision = "VERIFIED"
    else:
        verified = False
        decision = "SUSPICIOUS"

    logger.info(f"[ArcFace Verify] {request.studentId} -> {decision} (Avg: {average_similarity}, Best: {best_similarity})")

    msg_str = (
        "Face verified successfully."
        if verified
        else ("Multiple faces detected." if decision == "MULTIPLE_FACES_DETECTED" else "Face verification failed. Face does not sufficiently match the enrolled identity.")
    )

    response = {
        "success": True,
        "studentId": request.studentId,
        "verified": verified,
        "match": verified,
        "decision": decision,
        "finalDecision": decision,
        "result": decision.lower(),
        "bestSimilarity": best_similarity,
        "averageSimilarity": average_similarity,
        "validFrames": valid_count,
        "totalFrames": total_requested,
        "totalFramesProcessed": total_requested,
        "verifiedFrames": verified_count,
        "suspiciousFrames": suspicious_count,
        "rejectedFrames": rejected_count,
        "qualityScore": avg_quality,
        "multiFaceTriggered": multi_face_triggered,
        "elapsedSeconds": total_elapsed,
        "message": msg_str
    }

    if ENABLE_DIAGNOSTIC_MODE:
        response["diagnostic"] = {
            "rawSimilarities": frame_similarities,
            "bestSimilarity": best_similarity,
            "averageSimilarity": average_similarity,
            "verifiedFrames": verified_count,
            "suspiciousFrames": suspicious_count,
            "rejectedFrames": rejected_count,
            "thresholds": {
                "verified": SIMILARITY_THRESHOLD,
                "suspicious": SUSPICIOUS_THRESHOLD,
                "minRequiredFrames": MIN_VERIFICATION_FRAMES,
                "minAvgSimilarity": SIMILARITY_THRESHOLD,
                "minBestSimilarity": 0.70
            }
        }

    return response

@app.post("/api/arcface/debug-verify")
def arcface_debug_verify(request: ArcFaceVerifyRequest):
    """
    Diagnostic Endpoint: Test live frame against enrolled embeddings.
    """
    res = arcface_verify(request)
    return {
        "debugMode": True,
        "studentId": request.studentId,
        "enrolledSamplesCount": len(request.enrolledEmbeddings or []),
        "analysis": res
    }

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8001))
    uvicorn.run("main:app", host="0.0.0.0", port=port)
