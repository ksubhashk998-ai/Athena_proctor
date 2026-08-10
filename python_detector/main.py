"""
YOLOv8 & InsightFace ArcFace Biometric Microservice
Run with: uvicorn main:app --host 0.0.0.0 --port 8001
"""
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import base64
import io
import os
import cv2
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

app = FastAPI(
    title="InsightFace ArcFace & YOLOv8 Microservice",
    description="ArcFace Biometric Verification & Object Detection for Smart Proctoring",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# COCO class IDs relevant to proctoring (67 = cell phone)
PHONE_CLASS_ID = 67
HEADPHONE_KEYWORDS = ["earphone", "headphone", "earbud", "airpod", "headset"]

# Global Model References
_phone_model = None
_headphone_model = None

def get_insightface():
    """Load InsightFace buffalo_l ArcFace Model (512-d embeddings)"""
    global _insightface_app
    if _insightface_app is None and INSIGHTFACE_AVAILABLE:
        try:
            logger.info("🔄 Loading InsightFace ArcFace model (buffalo_l)...")
            app_face = FaceAnalysis(name='buffalo_l', providers=['CPUExecutionProvider'])
            app_face.prepare(ctx_id=0, det_size=(640, 640))
            _insightface_app = app_face
            logger.info("✅ ArcFace model loaded (InsightFace buffalo_l - 512d ArcFace)")
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

# ----------------- DATA MODELS -----------------

class DetectionRequest(BaseModel):
    imageBase64: str
    confidence_threshold: float = 0.35

class DetectionResponse(BaseModel):
    detected: bool
    detections: list
    model: str
    yolo_available: bool

class ArcFaceEnrollRequest(BaseModel):
    studentId: str
    name: str
    email: str
    frames: list  # list of 30 base64 images

class ArcFaceVerifyRequest(BaseModel):
    studentId: str
    email: str
    frames: list  # 30 live verification frames
    enrolledEmbeddings: list  # list of enrolled 512d vectors
    averageEmbedding: list = []  # 512d vector
    challengePose: str = None  # e.g., "turn_left", "turn_right", "look_up", "look_down"

# ----------------- UTILITY FUNCTIONS -----------------

def decode_image_np(imageBase64: str) -> np.ndarray:
    """Decode base64 image string to OpenCV BGR numpy array"""
    if "," in imageBase64:
        imageBase64 = imageBase64.split(",")[1]
    image_bytes = base64.b64decode(imageBase64)
    pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    rgb_arr = np.array(pil_img)
    return cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)

def normalize_l2(vec: np.ndarray) -> list:
    """Normalize vector to L2 unit length (512-dim ArcFace embedding)"""
    norm = np.linalg.norm(vec)
    if norm == 0 or np.isnan(norm):
        return vec.tolist()
    return (vec / norm).tolist()

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

def validate_face_quality(bgr_img: np.ndarray, face_obj) -> dict:
    """
    Perform strict biometric quality validation on face:
    1. Single face check
    2. Resolution check (>=160x160)
    3. Brightness check (40 <= mean <= 220)
    4. Blur check (Laplacian variance >= 60.0)
    5. Centered face check
    Returns quality_score (0-100), pass flag (>=80%), and details.
    """
    img_h, img_w = bgr_img.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in face_obj.bbox[:4]]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(img_w, x2), min(img_h, y2)
    
    face_w = x2 - x1
    face_h = y2 - y1
    
    # 1. Resolution Check
    resolution_pass = (face_w >= 160) and (face_h >= 160)
    res_score = min(100, (face_w * face_h) / (160 * 160) * 100)
    
    # Crop face region
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
    blur_pass = blur_var >= 60.0
    blur_score = min(100.0, (blur_var / 120.0) * 100.0)
    
    # 4. Centering Check
    cx = (x1 + x2) / 2.0
    cy = (y1 + y2) / 2.0
    center_dist = np.sqrt(((cx - img_w/2.0)/(img_w/2.0))**2 + ((cy - img_h/2.0)/(img_h/2.0))**2)
    centering_pass = center_dist <= 0.5
    centering_score = max(0.0, 100.0 * (1.0 - center_dist))
    
    overall_score = round(0.3 * res_score + 0.3 * blur_score + 0.2 * brightness_score + 0.2 * centering_score, 2)
    passed = resolution_pass and brightness_pass and blur_pass and centering_pass and (overall_score >= 80.0)
    
    return {
        "passed": passed,
        "score": overall_score,
        "resolution": f"{face_w}x{face_h}",
        "brightness": round(mean_brightness, 1),
        "blurVar": round(blur_var, 1),
        "centered": centering_pass,
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
    insight_loaded = _insightface_app is not None
    return {
        "status": "ok",
        "arcface_loaded": insight_loaded,
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

@app.post("/api/arcface/enroll")
async def arcface_enroll(request: ArcFaceEnrollRequest):
    """
    Enroll student with InsightFace ArcFace (buffalo_l):
    - Processes up to 30 frames
    - Validates quality score (>=80%), blur, brightness, resolution (>=160x160), single face
    - Extracts 512-dimensional L2-normalized embeddings
    - Computes average embedding vector
    - Requires at least 25 valid samples to complete enrollment
    """
    logger.info(f"🔄 Processing InsightFace ArcFace Enrollment for student: {request.studentId} ({len(request.frames)} frames)")
    
    app_face = get_insightface()
    if app_face is None:
        raise HTTPException(status_code=503, detail="InsightFace ArcFace (buffalo_l) engine not available.")
    
    embeddings = []
    quality_scores = []
    rejected_reasons = []
    
    for idx, b64_frame in enumerate(request.frames):
        try:
            bgr_img = decode_image_np(b64_frame)
            faces = app_face.get(bgr_img)
            
            if len(faces) == 0:
                rejected_reasons.append(f"Frame {idx+1}: No face detected")
                continue
            if len(faces) > 1:
                rejected_reasons.append(f"Frame {idx+1}: Multiple faces detected ({len(faces)})")
                continue
                
            face = faces[0]
            quality = validate_face_quality(bgr_img, face)
            quality_scores.append(quality["score"])
            
            if not quality["passed"]:
                rejected_reasons.append(f"Frame {idx+1}: {quality['reason']}")
                continue
                
            # Extract and L2-normalize 512d ArcFace embedding
            raw_emb = face.embedding
            norm_emb = normalize_l2(raw_emb)
            embeddings.append(norm_emb)
            
        except Exception as err:
            rejected_reasons.append(f"Frame {idx+1}: Processing error {str(err)}")
            
    valid_count = len(embeddings)
    logger.info(f"📊 ArcFace Enrollment result for {request.studentId}: {valid_count}/30 valid samples collected.")
    
    if valid_count < 25:
        return {
            "success": False,
            "error": f"Enrollment requires at least 25 valid face samples. Only {valid_count} valid samples were collected.",
            "validSamples": valid_count,
            "totalSubmitted": len(request.frames),
            "rejectedReasons": rejected_reasons[:10]
        }
        
    # Compute 512d average normalized embedding
    emb_matrix = np.array(embeddings, dtype=np.float32)
    mean_vec = np.mean(emb_matrix, axis=0)
    average_embedding = normalize_l2(mean_vec)
    
    avg_quality = round(float(np.mean(quality_scores)), 2) if quality_scores else 85.0
    
    logger.info(f"✅ [ArcFace Model Loaded] Saved {valid_count} x 512-dim ArcFace embeddings for {request.studentId}. Avg Quality: {avg_quality}%")
    
    return {
        "success": True,
        "studentId": request.studentId,
        "modelVersion": "InsightFace-ArcFace",
        "validSamples": valid_count,
        "embeddings": embeddings,
        "averageEmbedding": average_embedding,
        "averageQualityScore": avg_quality,
        "message": f"Successfully generated {valid_count} ArcFace 512d embeddings for {request.studentId}"
    }

@app.post("/api/arcface/verify")
async def arcface_verify(request: ArcFaceVerifyRequest):
    """
    Verify live camera frames using InsightFace ArcFace (buffalo_l):
    - Evaluates 30 live frames
    - Calculates Cosine Similarity against all enrolled 512-d embeddings
    - Frame Thresholds: >=0.92 VERIFIED, 0.88-0.92 SUSPICIOUS, <0.88 REJECTED
    - Final Decision: verifiedFrames >= 24 AND averageSimilarity >= 0.92 => VERIFIED
    - Anti-spoofing and Multi-face halt enforcement
    """
    logger.info(f"🔍 Running InsightFace ArcFace Verification for student: {request.studentId}")
    
    app_face = get_insightface()
    if app_face is None:
        raise HTTPException(status_code=503, detail="InsightFace ArcFace engine unavailable")
        
    if not request.enrolledEmbeddings or len(request.enrolledEmbeddings) == 0:
        raise HTTPException(status_code=400, detail="No enrolled face embeddings provided for comparison")
        
    enrolled_matrix = np.array(request.enrolledEmbeddings, dtype=np.float32) # (N, 512)
    
    verified_count = 0
    suspicious_count = 0
    rejected_count = 0
    multi_face_triggered = False
    frame_similarities = []
    quality_scores = []
    poses_detected = []
    
    for idx, b64_frame in enumerate(request.frames):
        try:
            bgr_img = decode_image_np(b64_frame)
            faces = app_face.get(bgr_img)
            
            if len(faces) > 1:
                logger.warn(f"🚨 MULTIPLE FACES DETECTED in frame {idx+1}")
                multi_face_triggered = True
                rejected_count += 1
                continue
                
            if len(faces) == 0:
                rejected_count += 1
                continue
                
            face = faces[0]
            quality = validate_face_quality(bgr_img, face)
            quality_scores.append(quality["score"])
            
            if not quality["passed"]:
                rejected_count += 1
                continue
                
            # Capture pose (pitch, yaw, roll)
            if hasattr(face, 'pose') and face.pose is not None:
                pitch, yaw, roll = face.pose
                poses_detected.append({"pitch": float(pitch), "yaw": float(yaw), "roll": float(roll)})
                
            # Extract ArcFace 512d L2 normalized embedding
            live_emb = normalize_l2(face.embedding)
            
            # Compute cosine similarity against all enrolled embeddings
            sims = [cosine_similarity(live_emb, enrolled_emb) for enrolled_emb in request.enrolledEmbeddings]
            best_sim = float(np.max(sims))
            frame_similarities.append(best_sim)
            
            # Per-frame Thresholding Policy
            if best_sim >= 0.92:
                verified_count += 1
            elif best_sim >= 0.88:
                suspicious_count += 1
            else:
                rejected_count += 1
                
        except Exception as err:
            logger.error(f"Error processing verification frame {idx+1}: {err}")
            rejected_count += 1
            
    # Compute aggregates
    best_similarity = round(float(np.max(frame_similarities)), 4) if frame_similarities else 0.0
    average_similarity = round(float(np.mean(frame_similarities)), 4) if frame_similarities else 0.0
    avg_quality = round(float(np.mean(quality_scores)), 2) if quality_scores else 0.0
    
    # Challenge verification check
    challenge_passed = True
    if request.challengePose and poses_detected:
        if request.challengePose == "turn_left":
            challenge_passed = any(p["yaw"] < -12 for p in poses_detected)
        elif request.challengePose == "turn_right":
            challenge_passed = any(p["yaw"] > 12 for p in poses_detected)
        elif request.challengePose == "look_up":
            challenge_passed = any(p["pitch"] < -10 for p in poses_detected)
        elif request.challengePose == "look_down":
            challenge_passed = any(p["pitch"] > 10 for p in poses_detected)

    # FINAL DECISION DETERMINATION
    if multi_face_triggered:
        final_decision = "MULTIPLE_FACES_DETECTED"
    elif not challenge_passed:
        final_decision = "CHALLENGE_FAILED"
    elif verified_count >= 24 and average_similarity >= 0.92:
        final_decision = "VERIFIED"
    elif verified_count >= 15:
        final_decision = "SUSPICIOUS"
    else:
        final_decision = "REJECTED"
        
    # Mandatory Debug Output
    logger.info("==================================================")
    logger.info("🛡️ INSIGHTFACE ARCFACE BIOMETRIC VERIFICATION AUDIT")
    logger.info("==================================================")
    logger.info(f"👤 Student ID:          {request.studentId}")
    logger.info(f"🧠 ArcFace Model Loaded: InsightFace-ArcFace (buffalo_l 512d)")
    logger.info(f"👤 Face Detected:        {'YES' if len(frame_similarities) > 0 else 'NO'}")
    logger.info(f"✨ Face Quality Score:   {avg_quality}%")
    logger.info(f"🎯 Best Similarity:      {best_similarity}")
    logger.info(f"📈 Average Similarity:   {average_similarity}")
    logger.info(f"🟢 Verified Frames:      {verified_count}/30")
    logger.info(f"🟡 Suspicious Frames:    {suspicious_count}/30")
    logger.info(f"🔴 Rejected Frames:      {rejected_count}/30")
    logger.info(f"🏁 Final Decision:       {final_decision}")
    logger.info("==================================================\n")
    
    return {
        "verified": final_decision == "VERIFIED",
        "result": final_decision,
        "bestSimilarity": best_similarity,
        "averageSimilarity": average_similarity,
        "verifiedFrames": verified_count,
        "suspiciousFrames": suspicious_count,
        "rejectedFrames": rejected_count,
        "qualityScore": avg_quality,
        "challengePassed": challenge_passed,
        "multiFaceTriggered": multi_face_triggered,
        "modelVersion": "InsightFace-ArcFace"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=False)

