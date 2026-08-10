const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, resendOtp, forgotPassword, resetPassword } = require('../controllers/otpController');

// OTP Authentication Endpoints
router.post('/send', sendOtp);
router.post('/verify', verifyOtp);
router.post('/resend', resendOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
