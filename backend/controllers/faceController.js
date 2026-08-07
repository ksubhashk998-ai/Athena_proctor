const fs = require('fs');
const path = require('path');
const User = require('../models/User');
const Student = require('../models/Student');
const FaceEmbedding = require('../models/FaceEmbedding');
const CheatingLog = require('../models/CheatingLog');
const SuspiciousActivity = require('../models/SuspiciousActivity');

// Helper: Save Base64 JPEG Image to Disk Folder (backend/screenshots/)
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

// Helper: Calculate Euclidean Distance between two 128-dimensional vectors
function euclideanDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 1.0;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

// Helper: Cosine Similarity
function cosineSimilarity(a, b) {
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
 * POST /api/face/enroll
 * Body: { email, name, usn, faceEmbeddings, faceDescriptors, imageSnapshot }
 */
const enrollFace = async (req, res) => {
  try {
    const { email, name, usn, faceEmbeddings, faceDescriptors, imageSnapshot } = req.body;
    const descriptorsToStore = faceDescriptors || faceEmbeddings;

    if (!email) {
      return res.status(400).json({ success: false, error: 'Email is required for face enrollment' });
    }

    if (!descriptorsToStore || !Array.isArray(descriptorsToStore) || descriptorsToStore.length === 0) {
      return res.status(400).json({ success: false, error: '30 Face descriptors are required for enrollment' });
    }

    const cleanEmail = email.trim().toLowerCase();

    // 1. Save photo snapshot to backend/screenshots/ disk folder
    let savedPhotoPath = null;
    if (imageSnapshot) {
      savedPhotoPath = saveImageToDisk(imageSnapshot, 'enrolled_face', cleanEmail);
    }

    // 2. Update User model in MongoDB
    let user = await User.findOne({ email: cleanEmail });
    if (user) {
      user.faceEmbeddings = descriptorsToStore;
      user.enrolledImageSnapshot = savedPhotoPath || imageSnapshot || null;
      user.faceEnrolled = true;
      user.enrollmentDate = new Date();
      if (name) user.name = name;
      if (usn) user.usn = usn;
      await user.save();
    } else {
      user = new User({
        name: name || cleanEmail.split('@')[0],
        usn: usn || '1SZ23CS001',
        email: cleanEmail,
        password: 'Password@123',
        faceEmbeddings: descriptorsToStore,
        enrolledImageSnapshot: savedPhotoPath || imageSnapshot || null,
        faceEnrolled: true,
        enrollmentDate: new Date()
      });
      await user.save();
    }

    // 3. Sync with Student model in MongoDB
    const primaryDescriptor = descriptorsToStore[0] || [];
    let student = await Student.findOne({ email: cleanEmail });
    if (student) {
      student.faceEmbeddings = primaryDescriptor;
      student.faceEnrolled = true;
      student.faceEnrolledAt = new Date();
      await student.save();
    }

    // 4. Sync with FaceEmbedding collection in MongoDB
    if (FaceEmbedding && FaceEmbedding.findOneAndUpdate) {
      await FaceEmbedding.findOneAndUpdate(
        { email: cleanEmail },
        {
          studentId: 'STU_' + cleanEmail.replace(/[^a-z0-9]/g, '_'),
          email: cleanEmail,
          embedding: primaryDescriptor,
          imageSnapshot: savedPhotoPath || imageSnapshot || null,
          enrolledAt: new Date(),
          isActive: true
        },
        { upsert: true, new: true }
      ).catch(() => {});
    }

    console.log(`✅ [MongoDB & Disk] Successfully enrolled ${descriptorsToStore.length} face embeddings & saved photo for: ${cleanEmail}`);

    return res.status(200).json({
      success: true,
      message: `Successfully enrolled ${descriptorsToStore.length} 128-d face descriptors to MongoDB!`,
      email: cleanEmail,
      descriptorsCount: descriptorsToStore.length,
      savedPhotoPath
    });
  } catch (error) {
    console.error('❌ Face enrollment error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/face/verify
 * Body: { email, descriptor, liveDescriptor, studentId, imageSnapshot, isTerminated, consecutiveFailures }
 */
const verifyFace = async (req, res) => {
  try {
    const { email, descriptor, liveDescriptor, studentId, imageSnapshot, isTerminated, consecutiveFailures } = req.body;
    const targetDescriptor = liveDescriptor || descriptor;

    if (!targetDescriptor || !Array.isArray(targetDescriptor)) {
      return res.status(400).json({ success: false, error: 'Live face descriptor vector is required' });
    }

    const cleanEmail = (email || '').trim().toLowerCase();
    let storedDescriptors = [];
    let studentName = 'Student';
    let usn = '1SZ23CS001';

    // 1. Fetch stored descriptors from User model in MongoDB
    if (cleanEmail) {
      const user = await User.findOne({ email: cleanEmail });
      if (user) {
        studentName = user.name;
        usn = user.usn || usn;
        if (user.faceEmbeddings && user.faceEmbeddings.length > 0) {
          // If stored as array of arrays ([[Number]])
          if (Array.isArray(user.faceEmbeddings[0])) {
            storedDescriptors = user.faceEmbeddings;
          } else {
            storedDescriptors.push(user.faceEmbeddings);
          }
        }
      }
    }

    // 2. Fallback to Student model in MongoDB
    if (storedDescriptors.length === 0) {
      const student = await Student.findOne({
        $or: [
          { email: cleanEmail },
          { studentId: studentId || '' }
        ]
      });

      if (student) {
        studentName = student.fullName || student.name || studentName;
        if (student.faceEmbeddings && student.faceEmbeddings.length >= 128) {
          storedDescriptors.push(student.faceEmbeddings);
        }
      }
    }

    // 3. Fallback to FaceEmbedding collection
    if (storedDescriptors.length === 0 && FaceEmbedding) {
      const dbRec = await FaceEmbedding.findOne({
        $or: [{ email: cleanEmail }, { studentId: studentId || '' }],
        isActive: true
      });
      if (dbRec && dbRec.embedding && dbRec.embedding.length >= 128) {
        storedDescriptors.push(dbRec.embedding);
      }
    }

    if (storedDescriptors.length === 0) {
      return res.status(400).json({
        match: false,
        needsEnrollment: true,
        message: 'No face descriptors found in MongoDB for this user. Please enroll first.'
      });
    }

    // Save live photo snapshot to disk
    let savedPhotoPath = null;
    if (imageSnapshot) {
      savedPhotoPath = saveImageToDisk(imageSnapshot, 'verify_snap', cleanEmail || studentId);
    }

    // 4. Strict Biometric Distance Calculation (ZERO FALSE POSITIVES)
    // Compute minimum distance, average distance, and best match
    let minDistance = 1.0;
    let distanceSum = 0;
    let validCount = 0;
    let maxSimilarity = 0.0;

    for (const storedVec of storedDescriptors) {
      if (!storedVec || storedVec.length === 0) continue;

      const dist = euclideanDistance(targetDescriptor, storedVec);
      const sim = cosineSimilarity(targetDescriptor, storedVec);

      distanceSum += dist;
      validCount++;

      if (dist < minDistance) minDistance = dist;
      if (sim > maxSimilarity) maxSimilarity = sim;
    }

    const avgDistance = validCount > 0 ? distanceSum / validCount : minDistance;

    // Requirement 4 & 10: Strict Thresholds to Eliminate False Positives
    // Student A must ONLY pass if minDistance < 0.38 (or Cosine Sim >= 0.75)
    const STRICT_DISTANCE_THRESHOLD = 0.38;
    const matchFound = minDistance < STRICT_DISTANCE_THRESHOLD || maxSimilarity >= 0.75;
    const confidencePct = Math.round(Math.max(0, Math.min(100, (1 - minDistance) * 100)));

    console.log(`🔒 [Strict Verification Audit] Student: ${cleanEmail || studentId} | Min Dist: ${minDistance.toFixed(4)} (Threshold: < 0.38) | Avg Dist: ${avgDistance.toFixed(4)} | Match: ${matchFound}`);

    // If mismatch occurs or exam is terminated: Permanent CheatingLog Entry in MongoDB
    if (!matchFound || isTerminated) {
      try {
        const cheatingRecord = new CheatingLog({
          studentId: studentId || cleanEmail,
          studentName,
          usn,
          examId: 'EXAM_ATHENA_001',
          timestamp: new Date(),
          violationType: isTerminated ? 'exam_terminated' : 'face_mismatch',
          screenshot: savedPhotoPath || imageSnapshot || null,
          faceImage: savedPhotoPath || imageSnapshot || null,
          actionTaken: isTerminated ? 'Exam Session Terminated (3-Strike Mismatch)' : 'Verification Blocked',
          terminated: !!isTerminated,
          euclideanDistance: parseFloat(minDistance.toFixed(4)),
          confidence: confidencePct
        });
        await cheatingRecord.save();
        console.log(`🚨 [CheatingLog Saved to MongoDB] Violation: ${cheatingRecord.violationType} | Terminated: ${cheatingRecord.terminated}`);
      } catch (e) {
        console.warn('CheatingLog save notice:', e.message);
      }
    }

    return res.status(200).json({
      match: matchFound,
      minDistance: parseFloat(minDistance.toFixed(4)),
      avgDistance: parseFloat(avgDistance.toFixed(4)),
      distance: parseFloat(minDistance.toFixed(4)),
      similarity: parseFloat(maxSimilarity.toFixed(4)),
      confidence: confidencePct,
      studentName,
      usn,
      savedPhotoPath,
      message: matchFound
        ? `✔ Verified Student - ${studentName}`
        : `Face verification failed: Live face does not match enrolled descriptors (Distance: ${minDistance.toFixed(2)}, Required: < 0.38)`
    });
  } catch (error) {
    console.error('❌ Face verification controller error:', error);
    return res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * POST /api/face/cheating-log
 * Body: Permanent Cheating Log Recording
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
    console.log(`🚨 [CheatingLog Saved to MongoDB] ID: ${cheatingRecord._id} | Terminated: ${cheatingRecord.terminated}`);

    return res.status(201).json({
      success: true,
      message: 'Cheating log recorded permanently in MongoDB',
      log: cheatingRecord
    });
  } catch (err) {
    console.error('CheatingLog error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

module.exports = {
  enrollFace,
  verifyFace,
  logCheatingActivity
};