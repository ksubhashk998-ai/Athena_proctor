const express = require('express');
const router = express.Router();

router.post('/face/register', (req, res) => {
  res.json({ success: true, message: 'Face registered successfully' });
});

router.post('/face/verify', (req, res) => {
  res.json({ match: true, confidence: 0.95, message: 'Face verified successfully' });
});

router.post('/face/detect', (req, res) => {
  res.json({ faceDetected: true, count: 1 });
});

router.get('/face/status/:userId', (req, res) => {
  res.json({ enrolled: true, userId: req.params.userId });
});

module.exports = router;