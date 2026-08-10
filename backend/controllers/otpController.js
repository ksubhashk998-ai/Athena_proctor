const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const OTP = require('../models/OTP');
const { sendOtpEmail } = require('../services/emailService');

let User = null;
let Student = null;
try { User = require('../models/User'); } catch (e) {}
try { Student = require('../models/Student'); } catch (e) {}

const JWT_SECRET = process.env.JWT_SECRET || 'your-secure-jwt-secret-key-here';
const COOLDOWN_SECONDS = 30;

/**
 * Helper to derive formatted student name from email
 */
function deriveStudentName(email) {
  const prefix = email.split('@')[0] || 'student';
  return prefix
    .split(/[._-]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/**
 * 1. Generate & Send OTP API
 * POST /api/otp/send
 */
const sendOtp = async (req, res) => {
  try {
    const { email, name } = req.body;
    if (!email || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Valid email address is required'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const studentName = name || deriveStudentName(cleanEmail);
    const now = new Date();

    // Check 30-second resend cooldown
    const existingOtp = await OTP.findOne({ email: cleanEmail });
    if (existingOtp && existingOtp.lastResendAt) {
      const elapsedSeconds = (now.getTime() - new Date(existingOtp.lastResendAt).getTime()) / 1000;
      if (elapsedSeconds < COOLDOWN_SECONDS) {
        const remaining = Math.ceil(COOLDOWN_SECONDS - elapsedSeconds);
        return res.status(429).json({
          success: false,
          error: `Please wait ${remaining} seconds before requesting a new OTP.`,
          cooldownRemaining: remaining
        });
      }
    }

    // Generate secure 6-digit random OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otpCode, 10);

    // Upsert temporary OTP record in MongoDB (5-minute TTL)
    await OTP.findOneAndUpdate(
      { email: cleanEmail },
      {
        email: cleanEmail,
        studentName,
        otpHash,
        attempts: 0,
        lastResendAt: now,
        createdAt: now
      },
      { upsert: true, new: true }
    );

    // Dispatch responsive HTML email via Gmail Nodemailer
    try {
      await sendOtpEmail(cleanEmail, studentName, otpCode);
    } catch (emailErr) {
      console.warn(`✉️ Email dispatch notice (${emailErr.message}). Active OTP: [${otpCode}]`);
    }

    console.log(`✉️ 6-Digit OTP generated & stored in MongoDB for ${cleanEmail}: ${otpCode}`);

    res.json({
      success: true,
      message: `A 6-digit OTP code has been dispatched to ${cleanEmail}`,
      email: cleanEmail,
      studentName,
      cooldownSeconds: COOLDOWN_SECONDS,
      expiresInSeconds: 300
    });
  } catch (error) {
    console.error('Error in sendOtp controller:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process OTP request: ' + error.message
    });
  }
};

/**
 * 2. Verify OTP API (Single-Use, Auto-Deletes on Success)
 * POST /api/otp/verify
 */
const verifyOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) {
      return res.status(400).json({
        success: false,
        error: 'Email and 6-digit OTP code are required'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();

    const otpRecord = await OTP.findOne({ email: cleanEmail });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        error: 'OTP expired or not found. Please request a new OTP code.'
      });
    }

    // Check maximum verification attempts (limit to 5 attempts)
    if (otpRecord.attempts >= 5) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        error: 'Maximum verification attempts exceeded. Please request a new OTP.'
      });
    }

    // Compare bcrypt hash
    const isMatch = await bcrypt.compare(cleanOtp, otpRecord.otpHash);

    if (!isMatch) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      const remainingAttempts = 5 - otpRecord.attempts;
      return res.status(400).json({
        success: false,
        error: `Invalid OTP code. (${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining)`
      });
    }

    // Single-use guarantee: Delete OTP record immediately from MongoDB upon successful verification
    await OTP.deleteOne({ _id: otpRecord._id });

    // Generate JWT token
    const studentId = 'STU_' + cleanEmail.replace(/[^a-z0-9]/g, '_');
    const token = jwt.sign(
      {
        email: cleanEmail,
        studentId,
        role: 'Student'
      },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    console.log(`✅ OTP Verification Successful for ${cleanEmail}. OTP record deleted from MongoDB.`);

    res.json({
      success: true,
      message: 'OTP verified successfully! Access granted.',
      token,
      student: {
        studentId,
        name: otpRecord.studentName || deriveStudentName(cleanEmail),
        email: cleanEmail,
        role: 'Student'
      }
    });
  } catch (error) {
    console.error('Error in verifyOtp controller:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during OTP verification: ' + error.message
    });
  }
};

/**
 * 3. Resend OTP API (Enforces 30s Cooldown)
 * POST /api/otp/resend
 */
const resendOtp = async (req, res) => {
  return sendOtp(req, res);
};

/**
 * 4. Forgot Password - Send OTP API
 * POST /api/otp/forgot-password
 */
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Valid registered email address is required.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const now = new Date();

    // Check if user exists in MongoDB database
    let existingUser = null;
    try {
      if (User) {
        existingUser = await User.findOne({ email: cleanEmail });
      }
      if (!existingUser && Student) {
        existingUser = await Student.findOne({ email: cleanEmail });
      }
    } catch (e) {}

    const studentName = existingUser?.name || deriveStudentName(cleanEmail);

    // Enforce 30-second resend cooldown
    const existingOtp = await OTP.findOne({ email: cleanEmail });
    if (existingOtp && existingOtp.lastResendAt) {
      const elapsedSeconds = (now.getTime() - new Date(existingOtp.lastResendAt).getTime()) / 1000;
      if (elapsedSeconds < COOLDOWN_SECONDS) {
        const remaining = Math.ceil(COOLDOWN_SECONDS - elapsedSeconds);
        return res.status(429).json({
          success: false,
          error: `Please wait ${remaining} seconds before requesting a new password reset OTP.`,
          cooldownRemaining: remaining
        });
      }
    }

    // Generate secure 6-digit random OTP
    const otpCode = crypto.randomInt(100000, 999999).toString();
    const otpHash = await bcrypt.hash(otpCode, 10);

    // Upsert temporary OTP record in MongoDB (5-minute TTL)
    await OTP.findOneAndUpdate(
      { email: cleanEmail },
      {
        email: cleanEmail,
        studentName,
        otpHash,
        attempts: 0,
        lastResendAt: now,
        createdAt: now
      },
      { upsert: true, new: true }
    );

    // Dispatch responsive HTML email via Nodemailer
    try {
      await sendOtpEmail(
        cleanEmail,
        studentName,
        otpCode,
        'Athena Smart Proctoring - Password Reset OTP',
        'Your One-Time Password (OTP) to reset your Athena Smart Proctoring account password is:'
      );
    } catch (emailErr) {
      console.warn(`✉️ Email dispatch notice (${emailErr.message}). Active Password Reset OTP: [${otpCode}]`);
    }

    console.log(`✉️ Password Reset 6-Digit OTP generated & stored in MongoDB for ${cleanEmail}: ${otpCode}`);

    return res.json({
      success: true,
      message: `A 6-digit password reset OTP code has been sent to ${cleanEmail}`,
      email: cleanEmail,
      studentName,
      cooldownSeconds: COOLDOWN_SECONDS,
      expiresInSeconds: 300
    });
  } catch (error) {
    console.error('Error in forgotPassword controller:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to process password reset OTP request: ' + error.message
    });
  }
};

/**
 * 5. Reset Password - Verify OTP & Update Password API
 * POST /api/otp/reset-password
 */
const resetPassword = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        success: false,
        error: 'Email, 6-digit OTP code, and new password are required.'
      });
    }

    if (typeof newPassword !== 'string' || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        error: 'New password must be at least 6 characters long.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanOtp = otp.toString().trim();

    const otpRecord = await OTP.findOne({ email: cleanEmail });

    if (!otpRecord) {
      return res.status(400).json({
        success: false,
        error: 'OTP expired or not found. Please request a new password reset OTP.'
      });
    }

    // Check maximum verification attempts (limit to 5 attempts)
    if (otpRecord.attempts >= 5) {
      await OTP.deleteOne({ _id: otpRecord._id });
      return res.status(400).json({
        success: false,
        error: 'Maximum verification attempts exceeded. Please request a new password reset OTP.'
      });
    }

    // Compare bcrypt hash
    const isMatch = await bcrypt.compare(cleanOtp, otpRecord.otpHash);

    if (!isMatch) {
      otpRecord.attempts += 1;
      await otpRecord.save();
      const remainingAttempts = 5 - otpRecord.attempts;
      return res.status(400).json({
        success: false,
        error: `Invalid OTP code. (${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining)`
      });
    }

    // Update password in MongoDB documents
    let updatedCount = 0;

    try {
      if (User) {
        const user = await User.findOne({ email: cleanEmail });
        if (user) {
          user.password = newPassword;
          await user.save();
          updatedCount++;
        }
      }
    } catch (e) {
      console.warn('Notice updating User password:', e.message);
    }

    try {
      if (Student) {
        const student = await Student.findOne({ email: cleanEmail });
        if (student) {
          student.password = newPassword;
          await student.save();
          updatedCount++;
        }
      }
    } catch (e) {
      console.warn('Notice updating Student password:', e.message);
    }

    // Delete used single-use OTP document
    await OTP.deleteOne({ _id: otpRecord._id });

    console.log(`🔑 Password successfully reset for ${cleanEmail}. Updated records: ${updatedCount}`);

    return res.json({
      success: true,
      message: 'Password reset successfully! You can now log in with your new password.',
      email: cleanEmail
    });
  } catch (error) {
    console.error('Error in resetPassword controller:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to reset password: ' + error.message
    });
  }
};

module.exports = {
  sendOtp,
  verifyOtp,
  resendOtp,
  forgotPassword,
  resetPassword
};
