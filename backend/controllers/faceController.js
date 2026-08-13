const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');

// Top level model imports
const FaceProfile = require('../models/FaceProfile');
const VerificationLog = require('../models/VerificationLog');
const User = require('../models/User');
const Student = require('../models/Student');

const PYTHON_SERVICE_URL = (process.env.PYTHON_DETECTOR_URL || 'http://127.0.0.1:8001').replace('localhost', '127.0.0.1');

// Helper: Save Base64 JPEG Image to Disk
function saveImageToDisk(base64Data, prefix, userIdentifier) {
  if (!base64Data || typeof base64Data !== 'string') return null;
  try {
    const screenshotsDir = path.join(__dirname, '../screenshots');
    if (!fs.existsSync(screenshotsDir)) {
      fs.mkdirSync(screenshotsDir, { recursive: true });
    }
    const cleanUser = (userIdentifier || 'student').replace(/[^a-z0-9]/gi, '_');
    const filename = `${prefix}_${cleanUser}_${Date.now()}.jpg`;
    const filepath = path.join(screenshotsDir, filename);

    const base64Image = base64Data.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(filepath, base64Image, { encoding: 'base64' });
    return `/screenshots/${filename}`;
  } catch (err) {
    console.warn('⚠️ Disk image save notice:', err.message);
    return null;
  }
}

// Helper: L2 Vector Normalization (512-dimensional)
function normalizeVector(vec) {
  if (!vec || !Array.isArray(vec) || vec.length === 0) return vec;
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

// Helper: Cosine Similarity between 512d normalized vectors
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  const sim = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return Math.max(0, Math.min(1.0, sim));
}

/**
 * POST /api/face/enroll
 * INSIGHTFACE ARCFACE STUDENT BIOMETRIC ENROLLMENT
 */
const enrollFace = async (req, res) => {
  try {
    const { studentId, name, email, usn, enrollmentImages, frames, imageSnapshot } = req.body;

    const cleanEmail = (email || '').trim().toLowerCase() || 'unknown@proctor.com';
    const cleanStudentId = (studentId || '').trim() || ('STU_' + cleanEmail.replace(/[^a-z0-9]/gi, '_'));
    const studentName = (name || '').trim() || cleanEmail.split('@')[0] || 'Student';

    const inputFrames = frames || enrollmentImages || (imageSnapshot ? [imageSnapshot] : []);

    if (!Array.isArray(inputFrames) || inputFrames.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'At least 20 high-quality face frames are required for ArcFace enrollment.'
      });
    }

    console.log("[BACKEND] Enrollment request received");
    console.log("[BACKEND] Submitting 30 frames to Python ArcFace service");

    const payload = {
      studentId: cleanStudentId,
      name: studentName,
      email: cleanEmail,
      frames: inputFrames.slice(0, 30)
    };

    console.log("Sending 30 enrollment samples...");
    console.log("Frames: 30");
    console.log("Payload size:", (JSON.stringify(payload).length / 1024 / 1024).toFixed(2), "MB");
    console.log("Sending enrollment request...");

    let arcfaceRes = null;
    try {
      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/arcface/enroll`, payload, { timeout: 180000 });
      console.log("Enrollment response:", response.data);
      arcfaceRes = response.data;
    } catch (pyErr) {
      console.error("=================================");
      console.error("ENROLLMENT ERROR DETAILS:");
      console.error("STATUS:", pyErr.response?.status);
      console.error("DATA:", JSON.stringify(pyErr.response?.data, null, 2));
      console.error("MESSAGE:", pyErr.message);
      console.error("=================================");
      return res.status(pyErr.response?.status || 500).json({
        success: false,
        error: pyErr.response?.data?.detail || pyErr.response?.data?.error || pyErr.message || "Python ArcFace enrollment failed"
      });
    }

    let embeddings = [];
    let averageEmbedding = [];
    let modelVersion = 'InsightFace-ArcFace';

    if (arcfaceRes && arcfaceRes.success && Array.isArray(arcfaceRes.embeddings)) {
      embeddings = arcfaceRes.embeddings.map(normalizeVector);
      averageEmbedding = normalizeVector(arcfaceRes.averageEmbedding || []);
      modelVersion = arcfaceRes.modelVersion || 'InsightFace-ArcFace';
    } else if (arcfaceRes && !arcfaceRes.success) {
      return res.status(400).json({
        success: false,
        error: arcfaceRes.error || 'Face enrollment failed quality validation checks.',
        details: arcfaceRes
      });
    } else {
      return res.status(503).json({
        success: false,
        error: 'Python ArcFace microservice unavailable. Please ensure ArcFace detector service is running on port 8001 and retry enrollment.'
      });
    }

    if (embeddings.length < 20) {
      return res.status(400).json({
        success: false,
        error: `Enrollment requires at least 20 valid face samples. Only ${embeddings.length} valid samples were generated.`
      });
    }

    // Verify dimensions (512d)
    for (let i = 0; i < embeddings.length; i++) {
      if (embeddings[i].length !== 512) {
        return res.status(400).json({
          success: false,
          error: `Invalid embedding dimension in face template (expected 512d, got ${embeddings[i].length}d)`
        });
      }
    }

    let savedImageUrls = inputFrames.slice(0, 5).map((img, idx) => {
      if (typeof img === 'string' && img.startsWith('data:image')) {
        return saveImageToDisk(img, `enroll_arcface_${idx+1}`, cleanStudentId) || img;
      }
      return img;
    });

    console.log("[ArcFace Enrollment] Student:", cleanStudentId);
    console.log("[ArcFace Enrollment] New embeddings:", embeddings.length);

    const existingProfile = await FaceProfile.findOne({
      $or: [{ studentId: cleanStudentId }, { email: cleanEmail }]
    });

    if (existingProfile) {
      console.log("[ArcFace Enrollment] Existing FaceProfile found");
      console.log("[ArcFace Enrollment] Updating existing enrollment");
      console.log("[ArcFace Enrollment] Previous embeddings:", existingProfile.embeddings?.length || 0);
      console.log("[ArcFace Enrollment] New embeddings:", embeddings.length);
    } else {
      console.log("[ArcFace Enrollment] No existing FaceProfile found");
      console.log("[ArcFace Enrollment] Creating new FaceProfile");
    }

    try {
      const savedProfile = await FaceProfile.findOneAndUpdate(
        { $or: [{ studentId: cleanStudentId }, { email: cleanEmail }] },
        {
          $set: {
            studentId: cleanStudentId,
            name: studentName,
            email: cleanEmail,
            enrollmentImages: savedImageUrls,
            embeddings: embeddings,
            averageEmbedding: averageEmbedding,
            modelVersion: modelVersion,
            enrollmentDate: new Date(),
            updatedAt: new Date()
          }
        },
        {
          new: true,
          upsert: true,
          runValidators: true,
          setDefaultsOnInsert: true
        }
      );

      if (existingProfile) {
        console.log("[ArcFace Enrollment] FaceProfile updated successfully");
      } else {
        console.log("[ArcFace Enrollment] FaceProfile created successfully");
      }
      console.log(`✅ FaceProfile saved successfully for ${cleanStudentId} with ${embeddings.length} embeddings`);

      return res.status(200).json({
        success: true,
        message: 'InsightFace ArcFace 512-d face profile enrolled successfully.',
        studentId: cleanStudentId,
        email: cleanEmail,
        enrolled: true,
        samplesCollected: embeddings.length,
        profile: savedProfile
      });
    } catch (dbErr) {
      console.error("❌ Database save error during face enrollment:", dbErr);
      if (dbErr.code === 11000) {
        const retryProfile = await FaceProfile.findOneAndUpdate(
          { studentId: cleanStudentId },
          {
            $set: {
              name: studentName,
              email: cleanEmail,
              enrollmentImages: savedImageUrls,
              embeddings: embeddings,
              averageEmbedding: averageEmbedding,
              modelVersion: modelVersion,
              updatedAt: new Date()
            }
          },
          { new: true }
        );
        if (retryProfile) {
          console.log("[ArcFace Enrollment] FaceProfile updated successfully via race condition handler");
          return res.status(200).json({
            success: true,
            message: 'InsightFace ArcFace 512-d face profile updated successfully.',
            studentId: cleanStudentId,
            email: cleanEmail,
            enrolled: true,
            samplesCollected: embeddings.length,
            profile: retryProfile
          });
        }
      }
      return res.status(500).json({
        success: false,
        error: "Face profile persistence failed. Please retry enrollment."
      });
    }
  } catch (err) {
    console.error('❌ ArcFace enrollment error:', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to enroll student face profile.'
    });
  }
};

/**
 * POST /api/face/verify
 * INSIGHTFACE ARCFACE BIOMETRIC IDENTITY VERIFICATION
 */
const verifyFace = async (req, res) => {
  try {
    const { studentId, email, frames, liveEmbeddings, descriptor, liveDescriptor, embedding, challengePose } = req.body;

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanStudentId = (studentId || '').trim();

    let profile = null;
    if (cleanEmail) profile = await FaceProfile.findOne({ email: cleanEmail });
    if (!profile && cleanStudentId) profile = await FaceProfile.findOne({ studentId: cleanStudentId });

    if (!profile) {
      return res.status(200).json({
        verified: false,
        match: false,
        result: 'REJECTED',
        verificationResult: 'REJECTED',
        reason: 'No face profile enrolled',
        needsEnrollment: true,
        error: 'No face profile enrolled for this student. Please complete face enrollment first.'
      });
    }

    if (!profile.embeddings || !Array.isArray(profile.embeddings) || profile.embeddings.length === 0) {
      return res.status(200).json({
        verified: false,
        match: false,
        result: 'REJECTED',
        verificationResult: 'REJECTED',
        reason: 'Corrupted MongoDB record',
        error: 'The registered face profile template is corrupted or empty.'
      });
    }

    const enrolledEmbeddings = profile.embeddings.map(normalizeVector);
    const averageEmbedding = normalizeVector(profile.averageEmbedding || profile.embeddings[0]);

    const inputFrames = frames || (liveEmbeddings ? liveEmbeddings : (descriptor || liveDescriptor || embedding ? [descriptor || liveDescriptor || embedding] : []));

    if (!inputFrames || !Array.isArray(inputFrames) || inputFrames.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No verification frames received",
        verified: false,
        match: false,
        result: 'REJECTED',
        error: 'No live camera frames provided for ArcFace verification.'
      });
    }

    console.log(`🔍 [ArcFace Verification] Verifying ${inputFrames.length} frames for student: ${cleanStudentId || cleanEmail} against ${enrolledEmbeddings.length} enrolled 512d embeddings...`);

    let arcfaceRes = null;
    const verificationFrames = Array.isArray(inputFrames) ? inputFrames.slice(0, 10) : [];

    try {
      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/arcface/verify`, {
        studentId: profile.studentId,
        email: profile.email,
        frames: verificationFrames,
        enrolledEmbeddings: enrolledEmbeddings,
        averageEmbedding: averageEmbedding,
        challengePose: challengePose || null
      }, { timeout: 90000 });

      arcfaceRes = response.data;
    } catch (pyErr) {
      console.error("=================================");
      console.error("PYTHON ERROR STATUS:", pyErr.response?.status);
      console.error("PYTHON ERROR DATA:", JSON.stringify(pyErr.response?.data, null, 2));
      console.error("PYTHON ERROR MESSAGE:", pyErr.message);
      console.error("=================================");
    }

    let verifiedFrames = 0;
    let suspiciousFrames = 0;
    let rejectedFrames = 0;
    let bestSimilarity = 0.0;
    let averageSimilarity = 0.0;
    let finalDecision = 'REJECTED';
    let isVerified = false;

    if (arcfaceRes) {
      bestSimilarity = typeof arcfaceRes.bestSimilarity === 'number' && !isNaN(arcfaceRes.bestSimilarity) ? arcfaceRes.bestSimilarity : 0.0;
      averageSimilarity = typeof arcfaceRes.averageSimilarity === 'number' && !isNaN(arcfaceRes.averageSimilarity) ? averageSimilarity : 0.0;
      verifiedFrames = typeof arcfaceRes.verifiedFrames === 'number' && !isNaN(arcfaceRes.verifiedFrames) ? arcfaceRes.verifiedFrames : 0;
      suspiciousFrames = typeof arcfaceRes.suspiciousFrames === 'number' && !isNaN(arcfaceRes.suspiciousFrames) ? arcfaceRes.suspiciousFrames : 0;
      rejectedFrames = typeof arcfaceRes.rejectedFrames === 'number' && !isNaN(arcfaceRes.rejectedFrames) ? arcfaceRes.rejectedFrames : 0;
      finalDecision = arcfaceRes.result || arcfaceRes.finalDecision || 'REJECTED';
      isVerified = finalDecision === 'VERIFIED' || finalDecision === 'verified';
    }

    const result = isVerified ? "VERIFIED" : (finalDecision === 'SUSPICIOUS' ? "SUSPICIOUS" : "REJECTED");

    console.log("=================================");
    console.log("ARC FACE VERIFICATION SUMMARY");
    console.log({
      studentId: profile.studentId,
      totalFrames: verificationFrames?.length || 0,
      verifiedFrames,
      rejectedFrames,
      suspiciousFrames,
      averageSimilarity,
      bestSimilarity,
      result
    });
    console.log("=================================");

    // Safely wrap database logging so a log saving error cannot turn a successful verification into a failed request
    try {
      await VerificationLog.create({
        studentId: profile.studentId,
        email: profile.email,
        result,
        rejectedFrames: Number(rejectedFrames) || 0,
        suspiciousFrames: Number(suspiciousFrames) || 0,
        verifiedFrames: Number(verifiedFrames) || 0,
        averageSimilarity: Number(averageSimilarity) || 0,
        bestSimilarity: Number(bestSimilarity) || 0
      });
      console.log("[VerificationLog] Saved successfully");
    } catch (logErr) {
      console.error("⚠️ [VerificationLog] Non-critical log creation warning:", logErr.message);
    }

    return res.status(200).json({
      success: isVerified,
      verified: isVerified,
      match: isVerified,
      result: result.toLowerCase(),
      finalDecision: finalDecision,
      verificationResult: finalDecision,
      studentId: profile.studentId,
      email: profile.email,
      bestSimilarity: bestSimilarity,
      averageSimilarity: averageSimilarity,
      verifiedFrames: verifiedFrames,
      suspiciousFrames: suspiciousFrames,
      rejectedFrames: rejectedFrames,
      totalFramesProcessed: verificationFrames.length,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    console.error('❌ ArcFace verification error:', err);
    return res.status(500).json({
      success: false,
      verified: false,
      match: false,
      result: 'rejected',
      verificationResult: 'REJECTED',
      message: 'Face verification failed. Please center your face and try again.',
      error: 'Face verification processing failed.'
    });
  }
};

/**
 * GET /api/face/profile/:id
 */
const getFaceProfile = async (req, res) => {
  try {
    const param = req.params.id;
    let profile = await FaceProfile.findOne({
      $or: [
        { studentId: param },
        { email: param.toLowerCase() }
      ]
    });

    if (!profile) {
      return res.status(200).json({
        success: false,
        enrolled: false,
        message: 'No face profile found for this student.'
      });
    }

    return res.status(200).json({
      success: true,
      enrolled: true,
      profile: profile
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

/**
 * POST /api/face/cheating-log
 */
const saveCheatingLog = async (req, res) => {
  try {
    const { studentId, studentEmail, eventType, severity, details, snapshot, imageSnapshot, examId, timestamp } = req.body;
    const cleanEmail = (studentEmail || '').trim().toLowerCase() || 'unknown@proctor.com';
    const cleanStudentId = (studentId || '').trim() || ('STU_' + cleanEmail.replace(/[^a-z0-9]/gi, '_'));

    let savedSnapshotUrl = null;
    const b64 = snapshot || imageSnapshot;
    if (b64 && typeof b64 === 'string' && b64.startsWith('data:image')) {
      savedSnapshotUrl = saveImageToDisk(b64, `violation_${eventType || 'anomaly'}`, cleanStudentId);
    }

    const logEntry = new VerificationLog({
      studentId: cleanStudentId,
      email: cleanEmail,
      eventType: eventType || 'PROCTOR_ANOMALY',
      status: severity === 'HIGH' || severity === 'CRITICAL' ? 'VIOLATION' : 'WARNING',
      verificationResult: severity === 'CRITICAL' ? 'TERMINATED' : 'FLAGGED',
      reason: details || eventType || 'Proctoring violation detected',
      snapshotUrl: savedSnapshotUrl || b64,
      examId: examId || 'EXAM_MAIN',
      timestamp: timestamp ? new Date(timestamp) : new Date()
    });

    await logEntry.save();
    return res.status(200).json({
      success: true,
      message: 'Violation log saved to database.',
      log: logEntry
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Failed to record proctoring violation.'
    });
  }
};

/**
 * GET /api/face/logs
 */
const getCheatingLogs = async (req, res) => {
  try {
    const { studentId, email, examId } = req.query;
    let query = {};
    if (studentId) query.studentId = studentId;
    if (email) query.email = email.toLowerCase();
    if (examId) query.examId = examId;

    const logs = await VerificationLog.find(query).sort({ timestamp: -1 }).limit(100);
    return res.status(200).json({
      success: true,
      count: logs.length,
      logs: logs
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message
    });
  }
};

/**
 * GET /api/face/debug/:studentId
 */
const getFaceDebug = async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const profile = await FaceProfile.findOne({ studentId });
    return res.json({
      success: true,
      studentId: studentId,
      enrolled: !!profile,
      embeddingsCount: profile?.embeddings?.length || 0,
      hasAverageEmbedding: !!profile?.averageEmbedding
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  enrollFace,
  verifyFace,
  getFaceProfile,
  saveCheatingLog,
  getCheatingLogs,
  getFaceDebug
};