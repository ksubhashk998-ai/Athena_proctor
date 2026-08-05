/**
 * faceVerificationService.js
 * Handles face-api.js model loading, enrollment and continuous verification.
 * Uses centralized model loading with proper guards to prevent
 * "TinyYolov2 - load model before inference" errors.
 */
import * as faceapi from '@vladmandic/face-api';

const MODEL_URL = '/models';

let modelsLoaded = false;
let modelsLoading = false;
let loadPromise = null;

/**
 * Load all required face-api.js models.
 * Safe to call multiple times - only loads once.
 * @returns {Promise<boolean>} true if models loaded successfully
 */
export async function loadFaceModels() {
    if (modelsLoaded) return true;

    // If already loading, wait for the existing promise
    if (modelsLoading && loadPromise) {
        return loadPromise;
    }

    modelsLoading = true;
    loadPromise = (async () => {
        try {
            console.log('🔄 Initializing TensorFlow.js engine & backend...');
            if (faceapi.tf) {
                await faceapi.tf.ready();
            }

            console.log('🔄 Loading face recognition models...');
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
                faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
                faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
            ]);

            // Verify critical models actually loaded (catches 0-byte files)
            if (!faceapi.nets.tinyFaceDetector.isLoaded) {
                throw new Error('TinyFaceDetector weights failed to load. Model files may be empty.');
            }
            if (!faceapi.nets.faceLandmark68Net.isLoaded) {
                throw new Error('FaceLandmark68Net weights failed to load. Model files may be empty.');
            }
            if (!faceapi.nets.faceRecognitionNet.isLoaded) {
                throw new Error('FaceRecognitionNet weights failed to load. Model files may be empty.');
            }

            modelsLoaded = true;
            modelsLoading = false;
            console.log('✅ Face recognition models loaded successfully');
            return true;
        } catch (err) {
            console.error('❌ Failed to load face models:', err);
            modelsLoading = false;
            modelsLoaded = false;
            loadPromise = null; // Allow retry
            return false;
        }
    })();

    return loadPromise;
}

/**
 * Check if models are currently loaded and ready for inference
 */
export function areModelsReady() {
    return modelsLoaded &&
        faceapi.nets.tinyFaceDetector.isLoaded &&
        faceapi.nets.faceLandmark68Net.isLoaded &&
        faceapi.nets.faceRecognitionNet.isLoaded;
}

/**
 * Capture a 128-d face descriptor from a video element
 * Returns Float32Array or null if no face detected
 */
export async function captureFaceDescriptor(videoElement) {
    // Ensure models are loaded before any inference
    if (!modelsLoaded) {
        const loaded = await loadFaceModels();
        if (!loaded) {
            console.error('Cannot capture face descriptor: models not loaded');
            return null;
        }
    }

    // Safety checks — allow readyState 2, 3, or 4 (any active frame)
    if (!videoElement) return null;
    if (videoElement.readyState < 2) {
        console.warn('Video not ready for face capture (readyState:', videoElement.readyState, ')');
        return null;
    }
    if (!faceapi.nets.tinyFaceDetector.isLoaded) {
        console.error('TinyFaceDetector not loaded - cannot run inference');
        return null;
    }

    try {
        const detection = await faceapi
            .detectSingleFace(videoElement, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.35 }))
            .withFaceLandmarks()
            .withFaceDescriptor();

        if (!detection) return null;
        return detection.descriptor; // Float32Array[128]
    } catch (err) {
        console.error('Face descriptor capture error:', err);
        return null;
    }
}

/**
 * Evaluate real-time face frame quality, geometry, brightness, and sharpness.
 * @param {HTMLVideoElement} videoElement 
 * @param {Object} detection - faceapi detection object with box & landmarks
 * @returns {Object} quality telemetry metrics
 */
export function evaluateFrameMetrics(videoElement, detection) {
    if (!videoElement || !detection) {
        return {
            isValid: false,
            qualityScore: 0,
            brightnessScore: 0,
            sharpnessScore: 0,
            faceSizeRatioPct: 0,
            isCentered: false,
            eyesOpen: false,
            message: 'No face detected'
        };
    }

    const box = detection.box || detection.detection?.box || { x: 0, y: 0, width: 100, height: 100 };
    const landmarks = detection.landmarks;
    const vWidth = videoElement.videoWidth || 640;
    const vHeight = videoElement.videoHeight || 480;

    // 1. Face Coverage / Size Ratio (Target 35% - 70% of frame height)
    const faceHeightRatio = (box.height / vHeight);
    const faceWidthRatio = (box.width / vWidth);
    const faceSizePct = Math.round(Math.max(faceHeightRatio, faceWidthRatio) * 100);
    const isSizeOk = faceSizePct >= 32 && faceSizePct <= 75;

    // 2. Guide Oval / Centering Check
    const centerX = box.x + box.width / 2;
    const centerY = box.y + box.height / 2;
    const isCenteredX = centerX >= vWidth * 0.15 && centerX <= vWidth * 0.85;
    const isCenteredY = centerY >= vHeight * 0.15 && centerY <= vHeight * 0.85;
    const isCentered = isCenteredX && isCenteredY;

    // 3. Eye Openness (EAR)
    let ear = 0.25;
    if (landmarks && landmarks.positions) {
        const pts = landmarks.positions;
        const lTop = (pts[37].y + pts[38].y) / 2;
        const lBot = (pts[40].y + pts[41].y) / 2;
        const lWidth = Math.abs(pts[39].x - pts[36].x) || 1;
        const lEar = Math.abs(lBot - lTop) / lWidth;

        const rTop = (pts[43].y + pts[44].y) / 2;
        const rBot = (pts[46].y + pts[47].y) / 2;
        const rWidth = Math.abs(pts[45].x - pts[42].x) || 1;
        const rEar = Math.abs(rBot - rTop) / rWidth;

        ear = (lEar + rEar) / 2;
    }
    const eyesOpen = ear >= 0.16;

    // 4. Brightness & Sharpness via Canvas Inspection
    let brightnessScore = 65;
    let sharpnessScore = 80;

    try {
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(160, Math.max(10, Math.floor(box.width)));
        canvas.height = Math.min(160, Math.max(10, Math.floor(box.height)));
        const ctx = canvas.getContext('2d');

        ctx.drawImage(
            videoElement,
            Math.max(0, box.x), Math.max(0, box.y), Math.max(10, box.width), Math.max(10, box.height),
            0, 0, canvas.width, canvas.height
        );

        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;

        let totalLuma = 0;
        const grays = new Float32Array(canvas.width * canvas.height);

        for (let i = 0; i < data.length; i += 4) {
            const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
            totalLuma += luma;
            grays[i / 4] = luma;
        }

        const avgLuma = totalLuma / (data.length / 4);
        brightnessScore = Math.round(Math.max(0, Math.min(100, (avgLuma / 255) * 100)));

        // Laplacian Variance for Sharpness
        let diffSum = 0;
        const w = canvas.width;
        const h = canvas.height;
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                const idx = y * w + x;
                const lap = grays[idx - 1] + grays[idx + 1] + grays[idx - w] + grays[idx + w] - 4 * grays[idx];
                diffSum += lap * lap;
            }
        }
        const variance = diffSum / Math.max(1, ((w - 2) * (h - 2)));
        sharpnessScore = Math.round(Math.min(100, Math.max(10, variance / 2.5)));
    } catch (e) {}

    const isBrightnessOk = brightnessScore >= 25 && brightnessScore <= 92;
    const isSharpnessOk = sharpnessScore >= 20;

    // Quality score weighted average
    const sizeScore = isSizeOk ? 95 : 40;
    const centerScore = isCentered ? 95 : 30;
    const qualityScore = Math.round(
        sharpnessScore * 0.35 +
        brightnessScore * 0.25 +
        sizeScore * 0.25 +
        centerScore * 0.15
    );

    const isValid = isSizeOk && isCentered && isBrightnessOk && isSharpnessOk;

    let message = '✓ Optimal Frame Quality';
    if (!isSizeOk) {
        message = faceSizePct < 32 ? '⚠️ Move CLOSER to camera (Target: 35-70%)' : '⚠️ Move BACK slightly (Target: 35-70%)';
    } else if (!isCentered) {
        message = '⚠️ Center your face inside the guide circle';
    } else if (!isBrightnessOk) {
        message = brightnessScore < 25 ? '⚠️ Environment too dark. Increase lighting' : '⚠️ Too bright / overexposed';
    } else if (!isSharpnessOk) {
        message = '⚠️ Image blurry. Keep steady & wipe lens';
    }

    return {
        isValid,
        qualityScore,
        brightnessScore,
        sharpnessScore,
        faceSizeRatioPct: faceSizePct,
        isCentered,
        eyesOpen,
        ear: parseFloat(ear.toFixed(3)),
        message
    };
}

/**
 * Apply L2 Normalization to embedding vector
 */
export function normalizeEmbedding(vector) {
    if (!vector || vector.length === 0) return vector;
    let normSq = 0;
    for (let i = 0; i < vector.length; i++) {
        normSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(normSq) || 1;
    return vector.map(v => parseFloat((v / norm).toFixed(6)));
}

/**
 * Compute average L2-normalized embedding vector across samples
 */
export function computeAverageEmbedding(descriptorsList) {
    if (!descriptorsList || descriptorsList.length === 0) return null;
    const dim = descriptorsList[0].length;
    const avg = new Array(dim).fill(0);
    for (let i = 0; i < dim; i++) {
        let sum = 0;
        for (const d of descriptorsList) {
            sum += d[i];
        }
        avg[i] = sum / descriptorsList.length;
    }
    return normalizeEmbedding(avg);
}

/**
 * Capture multiple face descriptors safely.
 * Note:
 * This version captures 3 frames from the live webcam.
 * It does not claim that the user actually turned left/right.
 */
export async function captureMultiAngleDescriptor(videoElement, onAngleProgress) {
    try {
        // Make sure models are loaded
        const loaded = await loadFaceModels();

        if (!loaded || !areModelsReady()) {
            console.error("Face models are not ready.");
            throw new Error("Face recognition models failed to load.");
        }

        // Check webcam
        if (!videoElement) {
            throw new Error("Video element not available.");
        }

        // Wait until webcam has a usable video frame
        if (videoElement.readyState < 2) {
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("Camera did not become ready in time."));
                }, 5000);

                const checkVideo = () => {
                    if (videoElement.readyState >= 2) {
                        clearTimeout(timeout);
                        resolve();
                    } else {
                        requestAnimationFrame(checkVideo);
                    }
                };

                checkVideo();
            });
        }

        const descriptors = [];

        const angleLabels = [
            "Front / Center Face",
            "Left Side Face",
            "Right Side Face"
        ];

        // Capture 3 frames
        for (let i = 0; i < 3; i++) {

            if (onAngleProgress) {
                onAngleProgress(
                    angleLabels[i],
                    i + 1,
                    3
                );
            }

            console.log(
                `📸 Capturing face ${i + 1}/3...`
            );

            const descriptor = await captureFaceDescriptor(
                videoElement
            );

            if (descriptor) {
                descriptors.push(
                    Array.from(descriptor)
                );

                console.log(
                    `✅ Face captured: ${i + 1}/3`
                );
            } else {
                console.warn(
                    `⚠️ No face detected in frame ${i + 1}`
                );
            }

            // Small delay between captures
            if (i < 2) {
                await new Promise(resolve =>
                    setTimeout(resolve, 500)
                );
            }
        }

        // No face detected at all
        if (descriptors.length === 0) {
            throw new Error(
                "No face detected in any of the 3 frames."
            );
        }

        console.log(
            `✅ Successfully captured ${descriptors.length}/3 face descriptors`
        );

        // Average all valid descriptors
        const avgDescriptor = descriptors[0].map(
            (_, index) => {
                const sum = descriptors.reduce(
                    (total, descriptor) =>
                        total + descriptor[index],
                    0
                );

                return sum / descriptors.length;
            }
        );

        return new Float32Array(avgDescriptor);

    } catch (error) {
        console.error(
            "❌ Multi-angle face capture failed:",
            error
        );

        throw error;
    }
}

/**
 * Calculate Cosine Similarity between two N-dimensional embedding vectors
 * @param {Array|Float32Array} a
 * @param {Array|Float32Array} b
 * @returns {number} Cosine similarity (-1.0 to 1.0)
 */
export function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Compare two face descriptors using ArcFace Cosine Similarity.
 * Returns { match, similarity, distance, confidence }
 */
export function compareDescriptors(desc1, desc2, simThreshold = 0.65) {
    if (!desc1 || !desc2) return { match: false, similarity: 0, distance: 1, confidence: 0 };
    const similarity = cosineSimilarity(desc1, desc2);
    const distance = faceapi.euclideanDistance(desc1, desc2);
    const confidence = Math.max(0, Math.min(1, (similarity - 0.35) / 0.55));
    return {
        match: similarity >= simThreshold,
        similarity: parseFloat(similarity.toFixed(4)),
        distance: parseFloat(distance.toFixed(4)),
        confidence: parseFloat(confidence.toFixed(4)),
    };
}

/**
 * Enroll face to backend. videoElement → descriptor → POST to API
 */
export async function enrollFace(videoElement, studentId, token) {
    const descriptor = await captureFaceDescriptor(videoElement);
    if (!descriptor) return { success: false, message: 'No face detected. Please face the camera clearly.' };

    // Capture thumbnail
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth;
    canvas.height = videoElement.videoHeight;
    canvas.getContext('2d').drawImage(videoElement, 0, 0);
    const imageSnapshot = canvas.toDataURL('image/jpeg', 0.5);

    const response = await fetch('/api/face/enroll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
            studentId,
            embedding: Array.from(descriptor),
            imageSnapshot,
        }),
    });

    const data = await response.json();
    return data;
}

/**
 * Verify face against stored embedding from backend
 */
export async function verifyFaceAgainstBackend(videoElement, studentId, token) {
    const descriptor = await captureFaceDescriptor(videoElement);
    if (!descriptor) return { match: false, confidence: 0, message: 'No face detected' };

    const response = await fetch('/api/face/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ studentId, embedding: Array.from(descriptor) }),
    });

    return await response.json();
}

/**
 * Start continuous face verification loop
 * Calls onResult({ status, confidence, message }) every intervalMs
 * Returns cleanup function
 */
export function startContinuousVerification(videoElement, studentId, token, onResult, intervalMs = 3000) {
    let noFaceTimer = null;
    let isRunning = true;

    const loop = async () => {
        if (!isRunning) return;

        // Safety: Don't run inference if models aren't loaded
        if (!areModelsReady()) {
            console.warn('Face models not ready, skipping verification cycle');
            if (isRunning) setTimeout(loop, intervalMs);
            return;
        }

        // Safety: Don't run if video isn't ready
        if (!videoElement || videoElement.readyState !== 4) {
            if (isRunning) setTimeout(loop, intervalMs);
            return;
        }

        try {
            const descriptor = await captureFaceDescriptor(videoElement);

            if (!descriptor) {
                if (!noFaceTimer) noFaceTimer = Date.now();
                const secondsNoFace = (Date.now() - noFaceTimer) / 1000;
                onResult({
                    status: secondsNoFace > 5 ? 'no_face_critical' : 'no_face',
                    confidence: 0,
                    message: `No face detected (${secondsNoFace.toFixed(0)}s)`,
                    secondsNoFace,
                });
            } else {
                noFaceTimer = null;
                const result = await verifyFaceAgainstBackend(videoElement, studentId, token);
                onResult({
                    status: result.match ? 'verified' : 'mismatch',
                    confidence: result.confidence,
                    message: result.message,
                    distance: result.distance,
                });
            }
        } catch (err) {
            console.error('Continuous verification error:', err);
        }

        if (isRunning) setTimeout(loop, intervalMs);
    };

    setTimeout(loop, intervalMs);
    return () => { isRunning = false; };
}
