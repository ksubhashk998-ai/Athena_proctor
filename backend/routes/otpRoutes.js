const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, resendOtp } = require('../controllers/otpController');

// OTP Authentication Endpoints
router.post('/send', sendOtp);
router.post('/verify', verifyOtp);
router.post('/resend', resendOtp);

module.exports = router;
