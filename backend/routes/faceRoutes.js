const express = require('express');
const router = express.Router();
const { 
  enrollFace, 
  verifyFace, 
  getFaceProfile, 
  saveCheatingLog, 
  getCheatingLogs,
  getFaceDebug 
} = require('../controllers/faceController');


// Specification 12: Backend APIs
// POST /api/face/enroll
router.post('/enroll', enrollFace);
router.post('/face/enroll', enrollFace);
router.post('/face/register', enrollFace);

// POST /api/face/verify
router.post('/verify', verifyFace);
router.post('/face/verify', verifyFace);

// GET /api/face/profile/:id
router.get('/profile/:id', getFaceProfile);
router.get('/face/profile/:id', getFaceProfile);

// GET /api/face/debug/:studentId
router.get('/debug/:studentId', getFaceDebug);
router.get('/face/debug/:studentId', getFaceDebug);

// GET /api/face/logs
router.get('/logs', getCheatingLogs);
router.get('/face/logs', getCheatingLogs);

// Cheating Logs API
router.post('/cheating-log', saveCheatingLog);
router.post('/face/cheating-log', saveCheatingLog);


// Status route
router.get('/status/:email', async (req, res) => {
  try {
    const FaceProfile = require('../models/FaceProfile');
    const FaceEmbedding = require('../models/FaceEmbedding');
    const Student = require('../models/Student');
    const User = require('../models/User');
    const cleanEmail = req.params.email.toLowerCase().trim();

    let profile = await FaceProfile.findOne({ email: cleanEmail });
    if (profile && profile.embeddings && profile.embeddings.length > 0) {
      return res.json({
        enrolled: true,
        descriptorsCount: profile.embeddings.length,
        embeddingDim: profile.embeddings[0] ? profile.embeddings[0].length : 512,
        name: profile.name,
        studentId: profile.studentId
      });
    }

    let faceEmb = await FaceEmbedding.findOne({ email: cleanEmail });
    if (faceEmb && faceEmb.embeddings && faceEmb.embeddings.length > 0) {
      return res.json({
        enrolled: true,
        descriptorsCount: faceEmb.embeddings.length,
        embeddingDim: faceEmb.embeddings[0] ? faceEmb.embeddings[0].length : 512,
        name: faceEmb.name,
        studentId: faceEmb.studentId
      });
    }

    const student = await Student.findOne({ email: cleanEmail });
    if (student && student.faceEnrolled) {
      return res.json({
        enrolled: true,
        descriptorsCount: student.faceEmbeddings ? (Array.isArray(student.faceEmbeddings[0]) ? student.faceEmbeddings.length : 1) : 0,
        name: student.fullName || student.name,
        studentId: student.studentId
      });
    }

    const user = await User.findOne({ email: cleanEmail });
    res.json({
      enrolled: !!(user && user.faceEnrolled),
      descriptorsCount: user && user.faceEmbeddings ? (Array.isArray(user.faceEmbeddings[0]) ? user.faceEmbeddings.length : 1) : 0,
      name: user ? user.name : ''
    });
  } catch (e) {
    res.json({ enrolled: false, descriptorsCount: 0 });
  }
});

module.exports = router;