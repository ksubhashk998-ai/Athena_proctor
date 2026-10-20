const express = require('express');
const router = express.Router();
const { sendOtp, verifyOtp, resendOtp, forgotPassword, resetPassword } = require('../controllers/otpController');

// OTP Authentication Endpoints
router.post('/send', sendOtp);
router.post('/send-otp', sendOtp);
router.post('/verify', verifyOtp);
router.post('/verify-otp', verifyOtp);
router.post('/resend', resendOtp);
router.post('/resend-otp', resendOtp);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);

module.exports = router;
