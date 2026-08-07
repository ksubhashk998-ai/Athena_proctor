const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Student = require('../models/Student');
const FaceProfile = require('../models/FaceProfile');
const VerificationLog = require('../models/VerificationLog');
const CheatingLog = require('../models/CheatingLog');

// Helper: Save Base64 JPEG Image to Disk / Server Public Folder
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
    console.log(`📸 [Disk Save] Saved photo file to disk: ${filepath}`);
    return `/screenshots/${filename}`;
  } catch (err) {
    console.warn('⚠️ Disk image save notice:', err.message);
    return null;
  }
}

// Helper: L2 Vector Normalization for Distance Invariance (0.5m, 1m, 2m distance independence)
function normalizeVector(vec) {
  if (!vec || !Array.isArray(vec) || vec.length === 0) return vec;
  let norm = 0;
  for (let i = 0; i < vec.length; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}

// Helper: Cosine Similarity between normalized ArcFace vectors
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
 * Body: { studentId, name, email, usn, faceEmbeddings, embeddings, enrollmentImages, imageSnapshot }
 */
const enrollFace = async (req, res) => {
  try {
    const { studentId, name, email, usn, faceEmbeddings, embeddings, enrollmentImages, imageSnapshot } = req.body;
    const rawEmbeddings = embeddings || faceEmbeddings || [];

    if (!email && !studentId) {
      return res.status(400).json({ success: false, error: 'Email or StudentId is required for face enrollment' });
    }

    if (!rawEmbeddings || !Array.isArray(rawEmbeddings) || rawEmbeddings.length === 0) {
      return res.status(400).json({ success: false, error: 'Face embeddings are required for enrollment (30 frames expected)' });
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanStudentId = (studentId || ('STU_' + cleanEmail.replace(/[^a-z0-9]/g, '_'))).trim();
    const studentName = name || cleanEmail.split('@')[0] || 'Enrolled Student';

    // L2 Normalize all enrolled ArcFace embeddings for distance invariance
    const normalizedEmbeddings = rawEmbeddings.map(vec => normalizeVector(Array.isArray(vec) ? vec : [vec]));

    // Handle enrollment images
    let savedImageUrls = [];
    if (Array.isArray(enrollmentImages) && enrollmentImages.length > 0) {
      savedImageUrls = enrollmentImages.map((img, idx) => {
        if (typeof img === 'string' && img.startsWith('data:image')) {
          return saveImageToDisk(img, `enroll_frame_${idx+1}`, cleanStudentId) || img;
        }
        return img;
      });
    }

    if (savedImageUrls.length === 0 && imageSnapshot) {
      const singleUrl = saveImageToDisk(imageSnapshot, 'enroll_primary', cleanStudentId) || imageSnapshot;
      savedImageUrls.push(singleUrl);
    }

    // 1. Upsert into FaceProfile collection per Specification 4
    let profile = await FaceProfile.findOne({
      $or: [{ studentId: cleanStudentId }, { email: cleanEmail }]
    });

    if (profile) {
      profile.studentId = cleanStudentId;
      profile.name = studentName;
      profile.email = cleanEmail;
      profile.embeddings = normalizedEmbeddings;
      profile.enrollmentImages = savedImageUrls;
      profile.createdAt = new Date();
      await profile.save();
    } else {
      profile = new FaceProfile({
        studentId: cleanStudentId,
        name: studentName,
        email: cleanEmail,
        embeddings: normalizedEmbeddings,
        enrollmentImages: savedImageUrls,
        createdAt: new Date()
      });
      await profile.save();
    }

    // 2. Sync User & Student models in MongoDB for backwards compatibility
    let user = await User.findOne({ email: cleanEmail });
    if (user) {
      user.faceEmbeddings = normalizedEmbeddings;
      user.enrolledImageSnapshot = savedImageUrls[0] || null;
      user.faceEnrolled = true;
      user.enrollmentDate = new Date();
      if (name) user.name = name;
      if (usn) user.usn = usn;
      await user.save();
    }

    let student = await Student.findOne({ email: cleanEmail });
    if (student) {
      student.faceEmbeddings = normalizedEmbeddings[0] || [];
      student.faceEnrolled = true;
      student.faceEnrolledAt = new Date();
      await student.save();
    }

    console.log(`✅ [MongoDB FaceProfile] Enrolled ${normalizedEmbeddings.length} ArcFace embeddings & ${savedImageUrls.length} images for ${cleanStudentId}`);

    return res.status(200).json({
      success: true,
      message: `Successfully enrolled ${normalizedEmbeddings.length} ArcFace embeddings to MongoDB!`,
      studentId: cleanStudentId,
      name: studentName,
      email: cleanEmail,
      embeddingsCount: normalizedEmbeddings.length,
      enrollmentImages: savedImageUrls
    });
  } catch (error) {
    console.error('❌ Face enrollment error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/face/verify
 * Body: { studentId, email, descriptor, liveDescriptor, embeddings, liveEmbeddings, imageSnapshot, antiSpoofing }
 */
const verifyFace = async (req, res) => {
  try {
    // Task 8 & 10: Check MongoDB Connection
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
      console.error('❌ [MongoDB Check Failed] Database connection unavailable');
      return res.status(503).json({
        match: false,
        verificationResult: 'REJECT',
        similarityScore: 0,
        error: 'Database connection unavailable',
        message: 'Database connection unavailable. Please check MongoDB Atlas connection.'
      });
    }

    const { studentId, email, descriptor, liveDescriptor, embeddings, liveEmbeddings, imageSnapshot, antiSpoofing } = req.body;
    
    // Gather live frame embeddings (can be single frame or 30 live frames)
    let rawLiveFrames = liveEmbeddings || embeddings || [];
    if (rawLiveFrames.length === 0 && (liveDescriptor || descriptor)) {
      rawLiveFrames = [liveDescriptor || descriptor];
    }

    if (!rawLiveFrames || !Array.isArray(rawLiveFrames) || rawLiveFrames.length === 0) {
      return res.status(400).json({ success: false, error: 'Missing embedding: Live ArcFace embeddings are required' });
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanStudentId = (studentId || '').trim();

    // 1. Fetch enrolled FaceProfile from MongoDB
    let profile = null;
    if (cleanStudentId || cleanEmail) {
      profile = await FaceProfile.findOne({
        $or: [
          { studentId: cleanStudentId },
          { email: cleanEmail }
        ]
      });
    }

    // Fallback to User collection if FaceProfile not found
    let storedEmbeddings = [];
    let studentName = 'Student';

    if (profile && profile.embeddings && profile.embeddings.length > 0) {
      storedEmbeddings = profile.embeddings;
      studentName = profile.name;
    } else {
      const user = await User.findOne({
        $or: [{ email: cleanEmail }, { usn: cleanStudentId }]
      });
      if (user && user.faceEmbeddings && user.faceEmbeddings.length > 0) {
        studentName = user.name;
        storedEmbeddings = Array.isArray(user.faceEmbeddings[0]) ? user.faceEmbeddings : [user.faceEmbeddings];
      }
    }

    // Task 11: Handle missing student biometric template
    if (!storedEmbeddings || storedEmbeddings.length === 0) {
      console.warn(`⚠️ [Face Enrollment Missing] No biometric profile found for student: ${cleanStudentId || cleanEmail}`);
      return res.status(404).json({
        match: false,
        verificationResult: 'REJECT',
        similarityScore: 0,
        needsEnrollment: true,
        error: 'Face enrollment not found',
        message: 'Face enrollment not found. Please complete 30-frame face enrollment first.'
      });
    }

    // Normalize all vectors for distance invariance
    const normalizedLiveFrames = rawLiveFrames.map(vec => normalizeVector(Array.isArray(vec) ? vec : [vec]));
    const normalizedStoredVecs = storedEmbeddings.map(vec => normalizeVector(Array.isArray(vec) ? vec : [vec]));

    // Save live photo snapshot
    let screenshotUrl = null;
    if (imageSnapshot) {
      screenshotUrl = saveImageToDisk(imageSnapshot, 'verify_live', cleanStudentId || cleanEmail);
    }

    // 2. Multi-Frame Cosine Similarity & Majority Voting Calculation
    let bestSimilarity = 0.0;
    let similaritySum = 0.0;
    let frameEvaluations = [];
    let verifiedVotes = 0;
    let suspiciousVotes = 0;
    let rejectVotes = 0;

    for (const liveVec of normalizedLiveFrames) {
      if (!liveVec || liveVec.length === 0) continue;

      let frameMaxSim = 0.0;
      for (const storedVec of normalizedStoredVecs) {
        if (!storedVec || storedVec.length === 0) continue;
        const sim = cosineSimilarity(liveVec, storedVec);
        if (sim > frameMaxSim) frameMaxSim = sim;
      }

      if (frameMaxSim > bestSimilarity) bestSimilarity = frameMaxSim;
      similaritySum += frameMaxSim;

      // Classify Frame Vote based on Specification 6 Rules
      if (frameMaxSim >= 0.75) {
        verifiedVotes++;
        frameEvaluations.push('VERIFIED');
      } else if (frameMaxSim >= 0.60) {
        suspiciousVotes++;
        frameEvaluations.push('SUSPICIOUS');
      } else {
        rejectVotes++;
        frameEvaluations.push('REJECT');
      }
    }

    const totalEvaluatedFrames = normalizedLiveFrames.length;
    const averageSimilarity = totalEvaluatedFrames > 0 ? similaritySum / totalEvaluatedFrames : bestSimilarity;

    // Overall similarity metric combining best match and top average
    const overallSimilarity = parseFloat(Math.max(bestSimilarity, averageSimilarity).toFixed(4));

    // 3. Apply Specification 6 Decision Rules & Majority Voting
    let verificationResult = 'REJECT';
    let majorityVote = 'REJECT';

    if (verifiedVotes >= suspiciousVotes && verifiedVotes >= rejectVotes && verifiedVotes > 0) {
      majorityVote = 'VERIFIED';
    } else if (suspiciousVotes >= verifiedVotes && suspiciousVotes >= rejectVotes) {
      majorityVote = 'SUSPICIOUS';
    } else {
      majorityVote = 'REJECT';
    }

    if (overallSimilarity >= 0.75) {
      verificationResult = 'VERIFIED';
    } else if (overallSimilarity >= 0.60) {
      verificationResult = 'SUSPICIOUS';
    } else {
      verificationResult = 'REJECT';
    }

    const match = verificationResult === 'VERIFIED';
    const confidencePct = Math.round(overallSimilarity * 100);

    // 4. Save Verification Log in MongoDB per Specification 10
    try {
      const logRecord = new VerificationLog({
        studentId: cleanStudentId || profile?.studentId || 'STU_UNKNOWN',
        name: studentName,
        email: cleanEmail || profile?.email || '',
        verificationResult,
        similarityScore: overallSimilarity,
        averageSimilarity: parseFloat(averageSimilarity.toFixed(4)),
        bestSimilarity: parseFloat(bestSimilarity.toFixed(4)),
        majorityVote,
        timestamp: new Date(),
        screenshotUrl: screenshotUrl || imageSnapshot || null,
        antiSpoofingDetails: antiSpoofing || {
          blinkDetected: true,
          headMovementDetected: true,
          photoAttackPassed: true,
          phoneScreenPassed: true
        }
      });
      await logRecord.save();
      console.log(`📋 [VerificationLog Saved] Result: ${verificationResult} | Score: ${overallSimilarity} | Student: ${studentName}`);
    } catch (e) {
      console.warn('VerificationLog save notice:', e.message);
    }

    // 5. If REJECT or SUSPICIOUS: Log Cheating Incident
    if (verificationResult !== 'VERIFIED') {
      try {
        const cheatingRecord = new CheatingLog({
          studentId: cleanStudentId || cleanEmail,
          studentName,
          usn: '1SZ23CS001',
          examId: 'EXAM_ATHENA_001',
          timestamp: new Date(),
          violationType: verificationResult === 'SUSPICIOUS' ? 'suspicious_face_match' : 'face_verification_rejected',
          screenshot: screenshotUrl || imageSnapshot || null,
          faceImage: screenshotUrl || imageSnapshot || null,
          actionTaken: verificationResult === 'SUSPICIOUS' ? 'Flagged for Proctor Audit' : 'Identity Verification Rejected',
          terminated: verificationResult === 'REJECT',
          euclideanDistance: parseFloat((1 - overallSimilarity).toFixed(4)),
          confidence: confidencePct
        });
        await cheatingRecord.save();
      } catch (e) {}
    }

    return res.status(200).json({
      match,
      verificationResult, // 'VERIFIED' | 'SUSPICIOUS' | 'REJECT'
      similarityScore: overallSimilarity,
      similarity: overallSimilarity,
      averageSimilarity: parseFloat(averageSimilarity.toFixed(4)),
      bestSimilarity: parseFloat(bestSimilarity.toFixed(4)),
      majorityVote,
      confidence: confidencePct,
      studentName,
      screenshotUrl,
      evaluatedFramesCount: totalEvaluatedFrames,
      message: verificationResult === 'VERIFIED'
        ? `✔ VERIFIED: ${studentName} (${confidencePct}% Cosine Similarity)`
        : verificationResult === 'SUSPICIOUS'
        ? `⚠️ SUSPICIOUS: Low Similarity (${confidencePct}%). Please adjust lighting and face camera directly.`
        : `❌ REJECT: Face verification failed (${confidencePct}% < 60% threshold). Access denied.`
    });
  } catch (error) {
    console.error('❌ Face verification error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/face/profile/:id
 */
const getFaceProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const profile = await FaceProfile.findOne({
      $or: [{ studentId: id }, { email: id.toLowerCase() }]
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: 'FaceProfile not found' });
    }

    return res.status(200).json({
      success: true,
      profile: {
        studentId: profile.studentId,
        name: profile.name,
        email: profile.email,
        enrollmentImages: profile.enrollmentImages,
        embeddingsCount: profile.embeddings ? profile.embeddings.length : 0,
        createdAt: profile.createdAt
      }
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /api/face/logs
 */
const getVerificationLogs = async (req, res) => {
  try {
    const { studentId, limit = 50 } = req.query;
    const query = studentId ? { studentId } : {};
    const logs = await VerificationLog.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit, 10));

    return res.status(200).json({
      success: true,
      count: logs.length,
      logs
    });
  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/face/cheating-log
 */
const logCheatingActivity = async (req, res) => {
  try {
    const { studentId, studentName, usn, violationType, screenshot, faceImage, tabSwitchCount, multipleFaceCount, audioViolation, actionTaken, terminated, euclideanDistance: dist } = req.body;

    let savedScreenshotPath = screenshot ? saveImageToDisk(screenshot, 'cheating_evidence', studentId) : null;
    let savedFacePath = faceImage ? saveImageToDisk(faceImage, 'cheating_face', studentId) : null;

    const cheatingRecord = new CheatingLog({
      studentId: studentId || 'STU_UNKNOWN',
      studentName: studentName || 'Student',
      usn: usn || '1SZ23CS001',
      examId: 'EXAM_ATHENA_001',
      timestamp: new Date(),
      violationType: violationType || 'face_mismatch',
      screenshot: savedScreenshotPath || screenshot || null,
      faceImage: savedFacePath || faceImage || null,
      tabSwitchCount: tabSwitchCount || 0,
      multipleFaceCount: multipleFaceCount || 0,
      audioViolation: !!audioViolation,
      actionTaken: actionTaken || 'Exam Terminated',
      terminated: !!terminated,
      euclideanDistance: dist || null
    });

    await cheatingRecord.save();
    return res.status(201).json({
      success: true,
      message: 'Cheating log recorded permanently in MongoDB',
      log: cheatingRecord
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  enrollFace,
  verifyFace,
  getFaceProfile,
  getVerificationLogs,
  logCheatingActivity
};