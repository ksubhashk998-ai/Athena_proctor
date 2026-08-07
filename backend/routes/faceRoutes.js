const express = require('express');
const router = express.Router();
const { 
  enrollFace, 
  verifyFace, 
  getFaceProfile, 
  getVerificationLogs, 
  logCheatingActivity 
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

// GET /api/face/logs
router.get('/logs', getVerificationLogs);
router.get('/face/logs', getVerificationLogs);

// Cheating Logs API
router.post('/cheating-log', logCheatingActivity);
router.post('/face/cheating-log', logCheatingActivity);

// Status route
router.get('/status/:email', async (req, res) => {
  try {
    const FaceProfile = require('../models/FaceProfile');
    const User = require('../models/User');
    const cleanEmail = req.params.email.toLowerCase();

    let profile = await FaceProfile.findOne({ email: cleanEmail });
    if (profile) {
      return res.json({
        enrolled: true,
        descriptorsCount: profile.embeddings ? profile.embeddings.length : 0,
        name: profile.name,
        studentId: profile.studentId
      });
    }

    const user = await User.findOne({ email: cleanEmail });
    res.json({
      enrolled: !!(user && user.faceEnrolled),
      descriptorsCount: user && user.faceEmbeddings ? user.faceEmbeddings.length : 0,
      name: user ? user.name : ''
    });
  } catch (e) {
    res.json({ enrolled: false, descriptorsCount: 0 });
  }
});

module.exports = router;