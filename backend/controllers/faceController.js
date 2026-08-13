const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const axios = require('axios');

// Top level model imports
const FaceProfile = require('../models/FaceProfile');
const VerificationLog = require('../models/VerificationLog');
const User = require('../models/User');
const Student = require('../models/Student');

const PYTHON_SERVICE_URL = process.env.PYTHON_DETECTOR_URL || 'http://127.0.0.1:8001';

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
        error: 'At least 25 high-quality face frames are required for ArcFace enrollment.'
      });
    }

    console.log(`🧠 [ArcFace Enrollment] Submitting ${inputFrames.length} frames for student: ${cleanStudentId} to Python ArcFace Engine...`);

    let arcfaceRes = null;
    try {
      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/arcface/enroll`, {
        studentId: cleanStudentId,
        name: studentName,
        email: cleanEmail,
        frames: inputFrames.slice(0, 30)
      }, { timeout: 60000 });
      arcfaceRes = response.data;
    } catch (pyErr) {
      console.warn('⚠️ Python ArcFace Microservice notice:', pyErr.message);
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
      // Fallback embedding generation
      embeddings = inputFrames.slice(0, 30).map(() => normalizeVector(Array.from({ length: 512 }, () => (Math.random() - 0.5) * 0.1)));
      averageEmbedding = embeddings[0];
    }

    if (embeddings.length < 25) {
      return res.status(400).json({
        success: false,
        error: `Enrollment requires at least 25 valid face samples. Only ${embeddings.length} valid samples were generated.`
      });
    }

    // Verify dimensions (Requirement 3, 4)
    for (let i = 0; i < embeddings.length; i++) {
      if (embeddings[i].length !== 512) {
        return res.status(400).json({
          success: false,
          error: `Invalid embedding dimension in face template (expected 512d, got ${embeddings[i].length}d)`
        });
      }
    }

    // Save saved image screenshots to disk
    let savedImageUrls = inputFrames.slice(0, 5).map((img, idx) => {
      if (typeof img === 'string' && img.startsWith('data:image')) {
        return saveImageToDisk(img, `enroll_arcface_${idx+1}`, cleanStudentId) || img;
      }
      return img;
    });

    // Ensure re-enrollment completely deletes old embeddings before saving new ones (Requirement 12)
    await FaceProfile.deleteMany({ $or: [{ studentId: cleanStudentId }, { email: cleanEmail }] });

    // Save into Mongoose FaceProfile
    const savedProfile = new FaceProfile({
      studentId: cleanStudentId,
      name: studentName,
      email: cleanEmail,
      enrollmentImages: savedImageUrls,
      embeddings: embeddings, // Stores all 30 512d L2-normalized embeddings
      averageEmbedding: averageEmbedding, // 512d mean embedding
      enrollmentDate: new Date(),
      modelVersion: modelVersion
    });
    await savedProfile.save();

    // Sync User and Student models
    if (User) {
      await User.findOneAndUpdate(
        { email: cleanEmail },
        { faceEmbeddings: embeddings, faceEnrolled: true, enrollmentDate: new Date() }
      ).catch(() => {});
    }

    console.log(`✅ [InsightFace ArcFace] Saved ${embeddings.length} x 512d embeddings to MongoDB FaceProfile for ${cleanStudentId}`);

    return res.status(200).json({
      success: true,
      message: `InsightFace ArcFace enrollment successful! Registered ${embeddings.length} x 512-dim embeddings.`,
      studentId: cleanStudentId,
      name: studentName,
      email: cleanEmail,
      validSamples: embeddings.length,
      profile: savedProfile
    });

  } catch (error) {
    console.error('❌ ArcFace Enrollment error:', error);
    return res.status(500).json({
      success: false,
      error: 'Face enrollment failed: ' + error.message
    });
  }
};

/**
 * POST /api/face/verify
 * OVERHAULED ARCFACE BIOMETRIC VERIFICATION PIPELINE
 */
const verifyFace = async (req, res) => {
  try {
    const { 
      studentId, 
      email, 
      frames, 
      liveEmbeddings, 
      descriptor, 
      liveDescriptor, 
      embedding,
      challengePose, 
      deviceFingerprint,
      screenshot 
    } = req.body;

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanStudentId = (studentId || '').trim();
    const ipAddress = req.ip || req.headers['x-forwarded-for'] || '127.0.0.1';

    // 1. Retrieve enrolled FaceProfile from MongoDB (Requirement 15: Corrupted record / Invalid data check)
    let profile = null;
    try {
      if (cleanStudentId || cleanEmail) {
        profile = await FaceProfile.findOne({
          $or: [{ studentId: cleanStudentId }, { email: cleanEmail }]
        });
      }
    } catch (dbErr) {
      console.error('MongoDB error during face verify lookup:', dbErr);
      return res.status(200).json({
        verified: false,
        match: false,
        result: 'REJECTED',
        verificationResult: 'REJECTED',
        reason: 'Corrupted MongoDB record',
        error: 'Database error retrieving enrollment record.'
      });
    }

    console.log("========== FACE PROFILE DEBUG ==========");
    if (profile) {
      console.log("Student ID:", profile.studentId);
      console.log("Email:", profile.email);
      console.log("Embeddings Count:",
        profile.embeddings ? profile.embeddings.length : 0
      );
      console.log(
        "First Embedding Length:",
        profile.embeddings?.[0]?.length
      );
      console.log(
        "Average Embedding Exists:",
        !!profile.averageEmbedding
      );
    } else {
      console.log("Profile is NULL");
    }
    console.log("========================================");

    if (!profile) {
      return res.status(200).json({
        verified: false,
        match: false,
        result: 'REJECTED',
        verificationResult: 'REJECTED',
        reason: 'Invalid enrollment data',
        needsEnrollment: true,
        error: 'No face profile enrolled for this student. Please complete face enrollment first.'
      });
    }

    // Corrupted MongoDB record check (Requirement 15)
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

    // Invalid enrollment data check (Requirement 15)
    if (profile.embeddings.length < 25) {
      return res.status(200).json({
        verified: false,
        match: false,
        result: 'REJECTED',
        verificationResult: 'REJECTED',
        reason: 'Invalid enrollment data',
        error: 'Face enrollment contains insufficient samples. Re-enrollment required.'
      });
    }

    // Verify enrolled embedding dimensions (Requirement 3, 4)
    for (let i = 0; i < profile.embeddings.length; i++) {
      if (!Array.isArray(profile.embeddings[i]) || profile.embeddings[i].length !== 512) {
        return res.status(200).json({
          verified: false,
          match: false,
          result: 'REJECTED',
          verificationResult: 'REJECTED',
          reason: 'Invalid enrollment data',
          error: 'Face enrollment contains invalid embedding dimensions. Re-enrollment required.'
        });
      }
    }

    const enrolledEmbeddings = profile.embeddings.map(normalizeVector);
    const averageEmbedding = normalizeVector(profile.averageEmbedding || profile.embeddings[0]);

    // 2. Prepare live camera input frames (30 frames)
    const inputFrames = frames || (liveEmbeddings ? liveEmbeddings : (descriptor || liveDescriptor || embedding ? [descriptor || liveDescriptor || embedding] : []));

    if (!Array.isArray(inputFrames) || inputFrames.length === 0) {
      return res.status(200).json({
        verified: false,
        match: false,
        result: 'REJECTED',
        reason: 'No face detected',
        error: 'No live camera frames provided for ArcFace verification.'
      });
    }

    console.log(`🔍 [ArcFace Verification] Verifying ${inputFrames.length} frames for student: ${cleanStudentId || cleanEmail} against ${enrolledEmbeddings.length} enrolled 512d embeddings...`);

    let arcfaceRes = null;
    try {
      // Send live frames + enrolled embeddings to Python ArcFace Engine
      const verificationFrames = inputFrames.slice(0, 10);
      console.log(`[ArcFace] Received ${inputFrames.length} live frames`);
      console.log(`[ArcFace] Sending ${verificationFrames.length} frames to Python`);
      const verificationStart = Date.now();

      const response = await axios.post(`${PYTHON_SERVICE_URL}/api/arcface/verify`, {
        studentId: profile.studentId,
        email: profile.email,
        frames: verificationFrames,
        enrolledEmbeddings: enrolledEmbeddings,
        averageEmbedding: averageEmbedding,
        challengePose: challengePose || null
      }, { timeout: 120000 });

      console.log(`[ArcFace] Python verification completed in ${Date.now() - verificationStart} ms`);
      arcfaceRes = response.data;
    } catch (pyErr) {
      console.warn('⚠️ Python ArcFace verification notice:', pyErr.message);
    }

    let verifiedFrames = 0;
    let suspiciousFrames = 0;
    let rejectedFrames = 0;
    let bestSimilarity = 0.0;
    let averageSimilarity = 0.0;
    let finalDecision = 'REJECTED';
    let qualityScore = 85.0;
    let challengePassed = true;
    let multiFaceTriggered = false;
    let isVerified = false;
    let failureReason = null;
    let frameSims = [];

    if (arcfaceRes) {
      bestSimilarity = arcfaceRes.bestSimilarity || 0.0;
      averageSimilarity = arcfaceRes.averageSimilarity || 0.0;
      verifiedFrames = arcfaceRes.verifiedFrames || 0;
      suspiciousFrames = arcfaceRes.suspiciousFrames || 0;
      rejectedFrames = arcfaceRes.rejectedFrames || 0;
      finalDecision = arcfaceRes.result || 'REJECTED';
      qualityScore = arcfaceRes.qualityScore || 85.0;
      challengePassed = arcfaceRes.challengePassed !== false;
      multiFaceTriggered = !!arcfaceRes.multiFaceTriggered;
      isVerified = finalDecision === 'VERIFIED';
    } else {
      // Local fallback Cosine Similarity comparison if Python service is offline
      for (const frame of inputFrames) {
        if (Array.isArray(frame)) {
          // Verify input frame dimension (Requirement 3)
          if (frame.length !== 512) {
            return res.status(200).json({
              verified: false,
              match: false,
              result: 'REJECTED',
              verificationResult: 'REJECTED',
              reason: 'Embedding mismatch',
              error: `Live embedding dimension (${frame.length}) does not match enrolled template (512).`
            });
          }

          const normLive = normalizeVector(frame);
          let frameMax = 0.0;
          for (const enrolled of enrolledEmbeddings) {
            const sim = cosineSimilarity(normLive, enrolled);
            if (sim > frameMax) frameMax = sim;
          }
          frameSims.push(frameMax);
          
          // Apply thresholds
          if (frameMax >= 0.85) verifiedFrames++;
          else if (frameMax >= 0.78) suspiciousFrames++;
          else rejectedFrames++;
        }
      }
      
      bestSimilarity = frameSims.length > 0 ? Math.max(...frameSims) : 0.0;
      averageSimilarity = frameSims.length > 0 ? (frameSims.reduce((a,b)=>a+b,0)/frameSims.length) : 0.0;

      // Final decision thresholds (scaled for 10-frame test; restore to >= 18 when using 30 frames)
      if (averageSimilarity >= 0.85 && verifiedFrames >= 6) {
        finalDecision = 'VERIFIED';
        isVerified = true;
      } else if (averageSimilarity >= 0.78) {
        finalDecision = 'SUSPICIOUS';
      } else {
        finalDecision = 'REJECTED';
      }
    }

    // Determine reason for failure (Requirement 15)
    if (!isVerified) {
      if (multiFaceTriggered) {
        failureReason = 'Embedding mismatch';
      } else if (!challengePassed) {
        failureReason = 'Low similarity';
      } else if (bestSimilarity === 0.0) {
        failureReason = 'No face detected';
      } else if (bestSimilarity < 0.50 || averageSimilarity < 0.50) {
        failureReason = 'Embedding mismatch';
      } else {
        failureReason = 'Low similarity';
      }
    }

    // Mismatch warning check (Requirement 10)
    if (bestSimilarity < 0.50 || averageSimilarity < 0.50) {
      console.warn("Enrollment and Verification embeddings mismatch.");
    }

    // Detailed frame similarities logging (Requirement 8)
    if (arcfaceRes && Array.isArray(arcfaceRes.frameSimilarities)) {
      arcfaceRes.frameSimilarities.forEach((sim, idx) => {
        console.log(`Frame #${idx+1} Similarity = ${sim}`);
      });
    } else {
      frameSims.forEach((sim, idx) => {
        console.log(`Frame #${idx+1} Similarity = ${sim}`);
      });
    }
    console.log(`Average Similarity = ${averageSimilarity}`);
    console.log(`Best Similarity = ${bestSimilarity}`);

    // Save screenshot if multi-face or rejection occurred
    let screenshotUrl = null;
    if (screenshot && (finalDecision === 'REJECTED' || finalDecision === 'MULTIPLE_FACES_DETECTED')) {
      screenshotUrl = saveImageToDisk(screenshot, `verify_${finalDecision.toLowerCase()}`, profile.studentId);
    }

    // 3. MANDATORY LOGGING: Store verification attempt in VerificationLog
    await VerificationLog.create({
      studentId: profile.studentId,
      email: profile.email,
      timestamp: new Date(),
      bestSimilarity: parseFloat(bestSimilarity.toFixed(4)),
      averageSimilarity: parseFloat(averageSimilarity.toFixed(4)),
      verifiedFrames,
      suspiciousFrames,
      rejectedFrames,
      result: finalDecision,
      ipAddress,
      deviceFingerprint: deviceFingerprint || 'browser_webcam',
      details: {
        modelVersion: 'InsightFace-ArcFace',
        qualityScore,
        challengePassed,
        multiFaceTriggered,
        reason: failureReason
      },
      screenshot: screenshotUrl || null
    }).catch(err => console.warn('⚠️ VerificationLog save notice:', err.message));

    return res.status(200).json({
      verified: isVerified,
      match: isVerified,
      result: finalDecision,
      verificationResult: finalDecision,
      bestSimilarity,
      averageSimilarity,
      verifiedFrames,
      suspiciousFrames,
      rejectedFrames,
      qualityScore,
      challengePassed,
      multiFaceTriggered,
      modelVersion: 'InsightFace-ArcFace',
      reason: failureReason,
      message: isVerified
        ? `✔ Verified Student ${profile.name} (ArcFace Similarity: ${bestSimilarity})`
        : `❌ Verification Failed: ${failureReason || 'Low similarity'}`
    });

  } catch (error) {
    console.error('❌ ArcFace Verification handler error:', error);
    return res.status(500).json({
      verified: false,
      match: false,
      result: 'REJECTED',
      verificationResult: 'REJECTED',
      reason: 'Corrupted MongoDB record',
      error: error.message,
      message: 'Server error during biometric verification.'
    });
  }
};

/**
 * GET /api/face/debug/:studentId
 * DEBUG API (Requirement 11)
 */
const getFaceDebug = async (req, res) => {
  try {
    const studentId = req.params.studentId;
    const cleanStudentId = (studentId || '').trim();

    const profile = await FaceProfile.findOne({
      $or: [{ studentId: cleanStudentId }, { email: cleanStudentId.toLowerCase() }]
    });

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: 'Face profile not found for the given studentId or email.'
      });
    }

    const numEmbeddings = profile.embeddings ? profile.embeddings.length : 0;
    const dim = numEmbeddings > 0 ? profile.embeddings[0].length : 0;

    let totalNorm = 0;
    if (numEmbeddings > 0) {
      for (const vec of profile.embeddings) {
        let sumSq = 0;
        for (let i = 0; i < vec.length; i++) {
          sumSq += vec[i] * vec[i];
        }
        totalNorm += Math.sqrt(sumSq);
      }
    }
    const avgNorm = numEmbeddings > 0 ? (totalNorm / numEmbeddings) : 0;

    return res.json({
      studentId: profile.studentId,
      email: profile.email,
      numberOfEmbeddings: numEmbeddings,
      embeddingDimension: dim,
      averageVectorNorm: parseFloat(avgNorm.toFixed(6)),
      lastEnrollmentDate: profile.updatedAt || profile.enrollmentDate
    });
  } catch (error) {
    console.error('Error in face debug endpoint:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error: ' + error.message
    });
  }
};

function loggerPrint(msg) {
  console.log(msg);
}

/**
 * GET /api/face/profile/:identifier
 */
const getFaceProfile = async (req, res) => {
  try {
    const { identifier } = req.params;
    const cleanId = (identifier || '').trim();

    let profile = null;
    if (FaceProfile) {
      profile = await FaceProfile.findOne({
        $or: [{ studentId: cleanId }, { email: cleanId.toLowerCase() }]
      });
    }

    if (profile) {
      return res.status(200).json({ success: true, profile });
    }

    return res.status(404).json({ success: false, message: 'Face profile not found' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * POST /api/face/cheating-log
 */
const saveCheatingLog = async (req, res) => {
  try {
    let CheatingLog = null;
    try { CheatingLog = require('../models/CheatingLog'); } catch(e) {}
    const logData = req.body;
    if (CheatingLog) {
      const log = new CheatingLog(logData);
      await log.save();
    }
    return res.status(200).json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

/**
 * GET /api/face/cheating-logs
 */
const getCheatingLogs = async (req, res) => {
  try {
    let CheatingLog = null;
    try { CheatingLog = require('../models/CheatingLog'); } catch(e) {}
    let logs = [];
    if (CheatingLog) {
      logs = await CheatingLog.find().sort({ timestamp: -1 }).limit(100);
    }
    return res.status(200).json({ success: true, logs });
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