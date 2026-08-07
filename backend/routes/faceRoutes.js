const express = require('express');
const router = express.Router();
const { enrollFace, verifyFace, logCheatingActivity } = require('../controllers/faceController');

// Requirement 3: POST /api/face/enroll
router.post('/enroll', enrollFace);
router.post('/face/enroll', enrollFace);

// Requirement 4: POST /api/face/verify
router.post('/verify', verifyFace);
router.post('/face/verify', verifyFace);

// Requirement 1 & 5: Permanent Cheating Logs & Terminated Exams
router.post('/cheating-log', logCheatingActivity);
router.post('/face/cheating-log', logCheatingActivity);

router.post('/face/register', enrollFace);

router.get('/status/:email', async (req, res) => {
  try {
    const User = require('../models/User');
    const user = await User.findOne({ email: req.params.email.toLowerCase() });
    res.json({
      enrolled: !!(user && user.faceEnrolled),
      descriptorsCount: user && user.faceEmbeddings ? user.faceEmbeddings.length : 0
    });
  } catch (e) {
    res.json({ enrolled: false, descriptorsCount: 0 });
  }
});

module.exports = router;