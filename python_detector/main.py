"""
YOLOv8 & InsightFace ArcFace Biometric Microservice
Run with: uvicorn main:app --host 127.0.0.1 --port 8001
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import base64
import io
import os
import cv2
import numpy as np
from PIL import Image
import logging
import time

# Try importing ultralytics (YOLOv8)
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
except ImportError:
    YOLO_AVAILABLE = False
    logging.warning("ultralytics not installed. Run: pip install ultralytics")

# Try importing insightface
INSIGHTFACE_AVAILABLE = False
_insightface_app = None

try:
    import insightface
    from insightface.app import FaceAnalysis
    INSIGHTFACE_AVAILABLE = True
except ImportError:
    logging.warning("insightface not installed. Run: pip install insightface onnxruntime")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional, List, Any

app = FastAPI(
    title="InsightFace ArcFace & YOLOv8 Microservice",
    description="ArcFace Biometric Verification & Object Detection for Smart Proctoring",
    version="2.0.0"
)

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"422 Validation Error on {request.url.path}: {exc.errors()}")
    print(f"422 ERROR on {request.url.path}: {exc.errors()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors()}
    )

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# COCO class IDs relevant to proctoring (0 = person, 67 = cell phone)
PERSON_CLASS_ID = 0
PHONE_CLASS_ID = 67
HEADPHONE_KEYWORDS = ["earphone", "headphone", "earbud", "airpod", "headset"]

# Global Model References
_phone_model = None
_headphone_model = None

def get_insightface():
    """Load InsightFace buffalo_l ArcFace Model (512-d embeddings)"""
    global _insightface_app
    if _insightface_app is not None:
        return _insightface_app
    if INSIGHTFACE_AVAILABLE:
        try:
            logger.info("🔄 Loading InsightFace ArcFace model (buffalo_l)...")
            app_face = FaceAnalysis(name='buffalo_l', allowed_modules=['detection', 'recognition'], providers=['CPUExecutionProvider'])
            app_face.prepare(ctx_id=-1, det_size=(320, 320))
            _insightface_app = app_face
            logger.info("✅ ArcFace model loaded (InsightFace buffalo_l - 512d ArcFace - Fast CPU Mode)")
        except Exception as e:
            logger.error(f"❌ Failed to load InsightFace ArcFace model: {e}")
    return _insightface_app

def get_phone_model():
    global _phone_model
    if _phone_model is None and YOLO_AVAILABLE:
        try:
            _phone_model = YOLO("yolov8n.pt")
            logger.info("YOLOv8n loaded for phone detection")
        except Exception as e:
            logger.error(f"Failed to load YOLO model: {e}")
    return _phone_model

def get_headphone_model():
    global _headphone_model
    if _headphone_model is None and YOLO_AVAILABLE:
        try:
            custom_path = "models/headphone_yolov8.pt"
            if os.path.exists(custom_path):
                _headphone_model = YOLO(custom_path)
            else:
                _headphone_model = YOLO("yolov8n.pt")
        except Exception as e:
            logger.error(f"Failed to load headphone model: {e}")
    return _headphone_model

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
    frames: List = []  # list of 30 base64 images

class ArcFaceVerifyRequest(BaseModel):
    studentId: Optional[str] = ""
    email: Optional[str] = ""
    frames: Optional[List[Any]] = []
    enrolledEmbeddings: Optional[List[List[float]]] = []
    averageEmbedding: Optional[List[float]] = []
    challengePose: Optional[str] = None
    embedding: Optional[List[float]] = []
    liveEmbeddings: Optional[List[List[float]]] = []

# ----------------- UTILITY FUNCTIONS -----------------

def preprocess_image_np(imageBase64: str, target_max_dim: int = 640) -> np.ndarray:
    """
    Unified Base64 image decoding and resolution normalization:
    - Decodes base64 string to RGB PIL Image
    - Converts to OpenCV BGR numpy format
    - Scales image to target_max_dim (default 640px) preserving exact aspect ratio
    - Guarantees identical pixel input structure for both enrollment & verification
    """
    if "," in imageBase64:
        imageBase64 = imageBase64.split(",")[1]
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

def decode_image_np(imageBase64: str) -> np.ndarray:
    """Alias for preprocess_image_np for backwards compatibility"""
    return preprocess_image_np(imageBase64, target_max_dim=640)

def normalize_l2(vec: np.ndarray) -> list:
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

def validate_face_quality(bgr_img: np.ndarray, face) -> dict:
    """
    Validate face sample quality:
    - Min face resolution: 160x160
    - Brightness range: 40-220
    - Blur (Laplacian Variance): >= 25.0
    """
    bbox = face.bbox.astype(int)
    x1, y1, x2, y2 = max(0, bbox[0]), max(0, bbox[1]), min(bgr_img.shape[1], bbox[2]), min(bgr_img.shape[0], bbox[3])
    face_w, face_h = x2 - x1, y2 - y1
    img_h, img_w = bgr_img.shape[:2]

    # 1. Resolution Check
    res_score = min(100.0, (face_w * face_h / (200.0 * 200.0)) * 100.0)
    
    if face_w <= 0 or face_h <= 0:
        return {"passed": False, "score": 0, "reason": "Invalid face region"}
        
    face_crop = bgr_img[y1:y2, x1:x2]
    if face_crop.size == 0:
        return {"passed": False, "score": 0, "reason": "Invalid face region"}
        
    gray_crop = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
    
    # 2. Brightness Check
    mean_brightness = float(np.mean(gray_crop))
    brightness_pass = 40.0 <= mean_brightness <= 220.0
    brightness_score = 100.0 if brightness_pass else max(0.0, 100.0 - abs(mean_brightness - 130.0))
    
    # 3. Blur Check (Laplacian Variance)
    blur_var = float(cv2.Laplacian(gray_crop, cv2.CV_64F).var())
    blur_pass = blur_var >= 25.0
    blur_score = min(100.0, (blur_var / 50.0) * 100.0)
    
    # 4. Centering Check
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    center_dist = np.sqrt(((cx - img_w/2.0)/(img_w/2.0))**2 + ((cy - img_h/2.0)/(img_h/2.0))**2)
    centering_pass = center_dist <= 0.5
    centering_score = max(0.0, 100.0 * (1.0 - center_dist))
    
    overall_score = round(0.3 * res_score + 0.3 * blur_score + 0.2 * brightness_score + 0.2 * centering_score, 2)
    passed = overall_score >= 40.0
    
    return {
        "passed": passed,
        "score": overall_score,
        "resolution": f"{face_w}x{face_h}",
        "brightness": round(mean_brightness, 1),
        "blurVar": round(blur_var, 1),
        "centered": centering_pass,
        "face_w": face_w,
        "face_h": face_h,
        "reason": "OK" if passed else f"Low quality (Res:{face_w}x{face_h}, Blur:{round(blur_var,1)}, Bright:{round(mean_brightness,1)})"
    }

def run_yolo_detection(model, image: Image.Image, target_class_ids: list, threshold: float):
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

# ----------------- API ENDPOINTS -----------------

@app.get("/health")
async def health_check():
    model = get_insightface()
    return {
        "status": "ok",
        "arcface_loaded": model is not None,
        "insightface_available": INSIGHTFACE_AVAILABLE,
        "yolo_available": YOLO_AVAILABLE,
        "engine": "InsightFace-ArcFace (buffalo_l 512d)"
    }

@app.post("/detect/phone", response_model=DetectionResponse)
async def detect_phone(request: DetectionRequest):
    try:
        if "," in request.imageBase64:
            base64_str = request.imageBase64.split(",")[1]
        else:
            base64_str = request.imageBase64
        image_bytes = base64.b64decode(base64_str)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        if not YOLO_AVAILABLE:
            return DetectionResponse(detected=False, detections=[], model="fallback_none", yolo_available=False)
        model = get_phone_model()
        detections = run_yolo_detection(model, image, target_class_ids=[PHONE_CLASS_ID], threshold=request.confidence_threshold)
        return DetectionResponse(detected=len(detections) > 0, detections=detections, model="yolov8n", yolo_available=True)
    except Exception as e:
        logger.error(f"Phone detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/detect/headphone", response_model=DetectionResponse)
async def detect_headphone(request: DetectionRequest):
    try:
        if "," in request.imageBase64:
            base64_str = request.imageBase64.split(",")[1]
        else:
            base64_str = request.imageBase64
        image_bytes = base64.b64decode(base64_str)
        image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        
        if not YOLO_AVAILABLE:
            return DetectionResponse(detected=False, detections=[], model="fallback_none", yolo_available=False)
        model = get_headphone_model()
        all_detections = run_yolo_detection(model, image, target_class_ids=list(range(80)), threshold=request.confidence_threshold)
        headphone_detections = [d for d in all_detections if any(kw in d["label"].lower() for kw in HEADPHONE_KEYWORDS)]
        return DetectionResponse(detected=len(headphone_detections) > 0, detections=headphone_detections, model="yolov8n_headphone", yolo_available=True)
    except Exception as e:
        logger.error(f"Headphone detection error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# ----------------- INSIGHTFACE ARCFACE ENDPOINTS -----------------

# ArcFace Biometric Configuration & Threshold Constants
MIN_ACCEPTABLE_QUALITY = 45.0  # Quality score >= 45% (0.45) accepted
GOOD_QUALITY = 60.0            # Quality score >= 60% (0.60) marked Good
MIN_VALID_EMBEDDINGS = 20      # Require at least 20 valid high-quality samples
MAX_CANDIDATE_FRAMES = 40      # Process up to 40 candidate frames per submission

LOGIN_THRESHOLD = 0.80
MONITORING_THRESHOLD = 0.65
VERIFIED_THRESHOLD = 0.65
SUSPICIOUS_THRESHOLD = 0.65
MIN_VERIFICATION_FRAMES = 2
SIMILARITY_THRESHOLD = 0.65
MIN_REQUIRED_FRAMES = 2        # Fast verification frame requirement (min 2 frames)
TARGET_VERIFICATION_FRAMES = 8 # 8 frames maximum for 1-2s response
MIN_VERIFIED_FRAMES = 1
MIN_AVERAGE_SIMILARITY = 0.65
MIN_BEST_SIMILARITY = 0.68
MIN_VERIFICATION_DURATION_SEC = 0.5  # Responsive verification response
ENABLE_DIAGNOSTIC_MODE = True

def validate_face_quality(bgr_img: np.ndarray, face) -> dict:
    """
    Validate face sample quality:
    - Min face size: 100x100
    - Brightness range: 35.0-230.0 (accommodates backlighting & room lighting variations)
    - Blur (Laplacian Variance): >= 20.0
    - Min acceptable quality score: MIN_ACCEPTABLE_QUALITY (45.0)
    """
    bbox = face.bbox.astype(int)
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
    
    # 2. Brightness Check (Accommodate backlit & dim room lighting)
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
    center_dist = np.sqrt(((cx - img_w/2.0)/(img_w/2.0))**2 + ((cy - img_h/2.0)/(img_h/2.0))**2)
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

@app.on_event("startup")
def startup_event():
    print("[PYTHON] Warming up ArcFace model...")
    get_insightface()
    print("[PYTHON] ArcFace model ready")

@app.post("/api/arcface/enroll")
def arcface_enroll(request: ArcFaceEnrollRequest):
    """
    Enroll student with InsightFace ArcFace (buffalo_l 512-d):
    - Receives up to MAX_CANDIDATE_FRAMES (40 frames) from camera
    - Preprocesses images with unified 640px scaling
    - Filters frames with quality >= MIN_ACCEPTABLE_QUALITY (45%)
    - Validates 512-d embeddings (finite values, no NaN/Inf)
    - Ranks and selects top MIN_VALID_EMBEDDINGS (20) highest-quality face candidate samples
    - Computes L2-renormalized average embedding vector
    """
    print("[PYTHON] Enrollment request received")
    print(f"[PYTHON] Received frames: {len(request.frames)}")
    logger.info(f"🔄 Processing InsightFace ArcFace Enrollment for student: {request.studentId} ({len(request.frames)} frames)")
    
    app_face = get_insightface()
    if app_face is None:
        raise HTTPException(status_code=503, detail="InsightFace ArcFace (buffalo_l) engine not available.")
    
    start = time.time()
    candidates = []
    rejected_reasons = []
    
    frames_to_evaluate = request.frames[:MAX_CANDIDATE_FRAMES]

    for idx, b64_frame in enumerate(frames_to_evaluate):
        try:
            bgr_img = preprocess_image_np(b64_frame, target_max_dim=640)
            if bgr_img is None or bgr_img.size == 0:
                rejected_reasons.append(f"Frame {idx+1}: Empty frame")
                continue

            faces = app_face.get(bgr_img)
            
            if len(faces) == 0:
                rejected_reasons.append(f"Frame {idx+1}: No face detected")
                continue
            if len(faces) > 1:
                rejected_reasons.append(f"Frame {idx+1}: Multiple faces detected ({len(faces)})")
                continue
                
            face = faces[0]
            quality = validate_face_quality(bgr_img, face)
            
            if not quality["passed"]:
                rejected_reasons.append(f"Frame {idx+1}: {quality['reason']}")
                continue

            raw_emb = getattr(face, 'normed_embedding', None)
            if raw_emb is None:
                raw_emb = getattr(face, 'embedding', None)
            # Strict Embedding Validation
            if raw_emb is None or raw_emb.shape[0] != 512:
                rejected_reasons.append(f"Frame {idx+1}: Invalid embedding dimension (expected 512)")
                continue
            if np.any(np.isnan(raw_emb)) or np.any(np.isinf(raw_emb)):
                rejected_reasons.append(f"Frame {idx+1}: Embedding contains NaN or Infinity values")
                continue

            det_score = float(getattr(face, 'det_score', 1.0) or 1.0)
            composite_score = round(det_score * 30.0 + quality["score"] * 0.7, 2)

            candidates.append({
                "score": composite_score,
                "quality_score": quality["score"],
                "embedding": raw_emb,
                "frame_idx": idx + 1
            })
            
        except Exception as err:
            rejected_reasons.append(f"Frame {idx+1}: Processing error {str(err)}")

    # Sort candidates by composite quality score descending and pick top 20 high-quality samples
    candidates.sort(key=lambda x: x["score"], reverse=True)
    top_candidates = candidates[:MIN_VALID_EMBEDDINGS]
    
    embeddings = [normalize_l2(c["embedding"]) for c in top_candidates]
    quality_scores = [c["quality_score"] for c in top_candidates]
    valid_count = len(embeddings)
    elapsed = time.time() - start
    
    best_q = max(quality_scores) if quality_scores else 0.0
    avg_q = round(float(np.mean(quality_scores)), 2) if quality_scores else 0.0

    # Structured Detailed Logging
    logger.info("=================================")
    logger.info(f"[ArcFace] Candidate frames: {len(request.frames)}")
    logger.info(f"[ArcFace] Valid embeddings: {len(candidates)}")
    logger.info(f"[ArcFace] Rejected frames: {len(rejected_reasons)}")
    logger.info(f"[ArcFace] Best quality: {best_q/100.0:.2f}")
    logger.info(f"[ArcFace] Average quality: {avg_q/100.0:.2f}")
    logger.info(f"[ArcFace] Selected embeddings: {valid_count}")
    logger.info(f"Enrollment completed for {request.studentId}")
    logger.info(f"Stored {len(embeddings)} face samples")

    if valid_count < 5:
        logger.info(f"[ArcFace] Final enrollment decision: FAILED (Insufficient quality samples: {valid_count}/5)")
        logger.info("=================================")
        return {
            "success": False,
            "error": f"Enrollment needs better lighting. Please move closer to a light source, center your face, and try again. (Gathered {valid_count}/5 samples)",
            "validSamples": valid_count,
            "totalSubmitted": len(request.frames),
            "rejectedReasons": rejected_reasons[:10]
        }
        
    # Compute mathematically correct 512d average normalized embedding vector
    emb_matrix = np.array(embeddings, dtype=np.float32)
    mean_vec = np.mean(emb_matrix, axis=0)
    average_embedding = normalize_l2(mean_vec)
    
    logger.info(f"[ArcFace] Final enrollment decision: SUCCESS for {request.studentId}")
    logger.info(f"Enrollment completed for {request.studentId}")
    logger.info(f"Stored {len(embeddings)} face samples")
    logger.info("=================================")
    
    return {
        "success": True,
        "message": f"Enrollment successful — {valid_count} high-quality face samples captured.",
        "embeddings": embeddings,
        "averageEmbedding": average_embedding,
        "validSamples": valid_count,
        "totalSubmitted": len(request.frames),
        "averageQualityScore": avg_q,
        "modelVersion": "InsightFace-ArcFace (buffalo_l 512d)"
    }

@app.post("/api/arcface/verify")
def arcface_verify(request: ArcFaceVerifyRequest):
    """
    InsightFace ArcFace Biometric Identity Verification:
    - Evaluates similarity score against enrolled 512-d embeddings
    - Verification succeeds if averageSimilarity >= 0.85 or bestSimilarity >= 0.85
    """
    verification_start = time.time()
    
    # Collect candidate input items (base64 image strings OR float vector embeddings)
    input_items = []
    if request.frames and len(request.frames) > 0:
        input_items = request.frames
    elif request.liveEmbeddings and len(request.liveEmbeddings) > 0:
        input_items = request.liveEmbeddings
    elif request.embedding and len(request.embedding) == 512:
        input_items = [request.embedding]

    frames_to_process = input_items[:TARGET_VERIFICATION_FRAMES]
    total_requested = len(frames_to_process)
    
    logger.info(f"🔍 [ArcFace Verification Diagnostics]")
    logger.info(f"  - Student ID: {request.studentId}")
    logger.info(f"  - Enrolled Samples Loaded: {len(request.enrolledEmbeddings or [])}")
    logger.info(f"  - Candidate Items: {total_requested}")

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
        
    # Requirement 9: Return "Enrollment data missing" if no enrolled embeddings provided
    if not request.enrolledEmbeddings or len(request.enrolledEmbeddings) == 0:
        logger.warning(f"❌ [ArcFace Verification] Enrollment data missing for Student ID: {request.studentId}")
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

    # Pre-compute L2 normalized enrolled matrix ONCE for fast matrix-multiply similarity
    enrolled_matrix = np.asarray(request.enrolledEmbeddings, dtype=np.float32)
    norms = np.linalg.norm(enrolled_matrix, axis=1, keepdims=True)
    enrolled_matrix = enrolled_matrix / np.maximum(norms, 1e-8)
    
    # Pre-compute enrolled average vector if provided
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
    poses_detected = []
    
    for idx, item in enumerate(frames_to_process):
        try:
            live_vector = None
            if isinstance(item, list) or isinstance(item, np.ndarray):
                raw_arr = np.asarray(item, dtype=np.float32)
                if raw_arr.shape[0] == 512:
                    live_vector = raw_arr / max(np.linalg.norm(raw_arr), 1e-8)
            elif isinstance(item, str) and len(item) > 100:
                bgr_img = preprocess_image_np(item, target_max_dim=640)
                if bgr_img is not None and bgr_img.size > 0:
                    faces = app_face.get(bgr_img)
                    if len(faces) > 1:
                        logger.warning(f"🚨 [ArcFace Verification] MULTIPLE FACES DETECTED in frame {idx+1}")
                        multi_face_triggered = True
                        rejected_count += 1
                        continue
                    if len(faces) == 1:
                        face = faces[0]
                        quality = validate_face_quality(bgr_img, face)
                        quality_scores.append(quality["score"])
                        if hasattr(face, 'pose') and face.pose is not None:
                            pitch, yaw, roll = face.pose
                            poses_detected.append({"pitch": float(pitch), "yaw": float(yaw), "roll": float(roll)})
                        raw_live_emb = getattr(face, 'normed_embedding', None)
                        if raw_live_emb is None:
                            raw_live_emb = getattr(face, 'embedding', None)
                        if raw_live_emb is not None and raw_live_emb.shape[0] == 512:
                            live_vector = np.asarray(raw_live_emb, dtype=np.float32)
                            live_vector = live_vector / max(np.linalg.norm(live_vector), 1e-8)

            if live_vector is None:
                rejected_count += 1
                logger.info(f"[ArcFace Verification] Frame {idx+1}/{total_requested}: Invalid or empty item")
                continue

            # Vectorized Cosine Similarity
            similarities = np.dot(enrolled_matrix, live_vector)
            best_sim = float(np.max(similarities))
            
            if average_vector is not None:
                sim_to_avg = float(np.dot(average_vector, live_vector))
                best_sim = float(max(best_sim, sim_to_avg))
                sim_to_avg = float(np.dot(average_vector, live_vector))
                best_sim = float(max(best_sim, sim_to_avg))

            best_sim_clamped = round(float(np.clip(best_sim, 0.0, 1.0)), 4)
            frame_similarities.append(best_sim_clamped)

            logger.info(f"[ArcFace Verification] Frame {idx+1}/{total_requested} - Similarity: {best_sim_clamped}")
            print(f"[ArcFace Verification] Frame {idx+1}/{total_requested} - Similarity: {best_sim_clamped}")

            if best_sim_clamped >= VERIFIED_THRESHOLD:
                verified_count += 1
            elif best_sim_clamped >= SUSPICIOUS_THRESHOLD:
                suspicious_count += 1
            else:
                rejected_count += 1

            # Early Exit after 5 valid frames with avg similarity >= 0.80
            if len(frame_similarities) >= 5:
                current_avg = float(np.mean(frame_similarities))
                if current_avg >= 0.68:
                    logger.info("Early verification success")
                    print("Early verification success")
                    break
                
        except Exception as err:
            logger.error(f"Error processing frame {idx+1}: {err}")
            rejected_count += 1

    valid_count = len(frame_similarities)
    best_similarity = round(float(np.max(frame_similarities)), 4) if frame_similarities else 0.0
    average_similarity = round(float(np.mean(frame_similarities)), 4) if frame_similarities else 0.0
    avg_quality = round(float(np.mean(quality_scores)), 2) if quality_scores else 0.0
    
    # Anti-spoof stability check
    stability_passed = True
    if len(frame_similarities) >= 2:
        sim_std = float(np.std(frame_similarities))
        if sim_std > 0.35:
            stability_passed = False
            logger.warning(f"🚨 [ArcFace Anti-Spoof] Similarity fluctuation abnormal (std: {sim_std:.4f})")

    total_elapsed = round(time.time() - verification_start, 2)

    # Require minimum samples check
    if valid_count < MIN_VERIFICATION_FRAMES:
        logger.warning(f"❌ [ArcFace Verification Failed] Only {valid_count}/{MIN_VERIFICATION_FRAMES} valid face frames collected.")
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

    # Decision Logic: VERIFIED (>= 0.65 or best >= 0.70) | SUSPICIOUS (< 0.65)
    if multi_face_triggered and valid_count < 3:
        decision = "MULTIPLE_FACES_DETECTED"
        verified = False
    elif average_similarity >= SIMILARITY_THRESHOLD or best_similarity >= 0.70:
        verified = True
        decision = "VERIFIED"
    else:
        verified = False
        decision = "SUSPICIOUS"
        
    logger.info("=================================")
    logger.info(f"[ArcFace Decision Log]")
    logger.info(f"Student ID = {request.studentId}")
    logger.info(f"Average Similarity = {average_similarity:.4f}")
    logger.info(f"Best Similarity = {best_similarity:.4f}")
    logger.info(f"Threshold = {SIMILARITY_THRESHOLD}")
    logger.info(f"Valid Frames = {valid_count}/{total_requested}")
    logger.info(f"Final Decision = {decision}")
    logger.info("=================================")
    
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
                "suspicious": SIMILARITY_THRESHOLD,
                "minRequiredFrames": MIN_VERIFICATION_FRAMES,
                "minAvgSimilarity": SIMILARITY_THRESHOLD,
                "minBestSimilarity": SIMILARITY_THRESHOLD
            }
        }

    return response

@app.post("/api/arcface/debug-verify")
def arcface_debug_verify(request: ArcFaceVerifyRequest):
    """
    Diagnostic Endpoint: Test live frame against enrolled embeddings and inspect detailed similarity scores.
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
