/**
 * proctorApi.js - All new proctoring API routes
 * Mounted at /api in server.js
 */
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');
const { sendOtpEmail } = require('../services/emailService');

const mongoose = require('mongoose');
try { mongoose.set('bufferCommands', false); } catch(e) {}

const FaceProfile = require('../models/FaceProfile');
const User = require('../models/User');
const FaceEmbedding = require('../models/FaceEmbedding');
const SuspiciousActivity = require('../models/SuspiciousActivity');
const ScreenshotEvidence = require('../models/ScreenshotEvidence');
const Student = require('../models/Student');
const Incident = require('../models/Incident');
const VerificationLog = require('../models/VerificationLog');


const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
const PYTHON_DETECTOR_URL = (process.env.PYTHON_DETECTOR_URL || 'http://127.0.0.1:8001').replace('localhost', '127.0.0.1');

// In-memory student registry cache
const inMemoryStudents = new Map();

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
    console.log(`📸 [Disk Save] Saved JPEG photo file to disk: ${filepath}`);
    return `/screenshots/${filename}`;
  } catch (err) {
    console.warn('⚠️ Disk image save notice:', err.message);
    return null;
  }
}

// Vector math helper functions
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

function euclideanDistance(a, b) {
    if (!a || !b || a.length !== b.length) return 1;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        const diff = a[i] - b[i];
        sum += diff * diff;
    }
    return Math.sqrt(sum);
}


// In-memory OTP Store: Map<cleanEmail, { hashedOtp, attempts, expiresAt, lastSentAt, studentId, studentName }>
const otpStore = new Map();

// =========================================================================
// REAL-TIME EMAIL OTP AUTHENTICATION ENDPOINTS (With Path Aliases)
// =========================================================================

const handleSendOtp = async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || typeof email !== 'string' || !email.includes('@')) {
            return res.status(400).json({ success: false, error: 'Valid email address is required' });
        }

        const cleanEmail = email.trim().toLowerCase();
        if (password && password.length < 3) {
            return res.status(401).json({ success: false, error: 'Invalid email or password' });
        }

        const studentId = 'STU_' + cleanEmail.replace(/[^a-z0-9]/g, '_');
        const emailPrefix = cleanEmail.split('@')[0];
        const studentName = emailPrefix
            .split(/[._-]/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

        const now = Date.now();

        // Generate secure 6-digit OTP
        const otp = crypto.randomInt(100000, 999999).toString();
        const hashedOtp = crypto.createHash('sha256').update(otp).digest('hex');

        otpStore.set(cleanEmail, {
            hashedOtp,
            attempts: 0,
            expiresAt: now + 5 * 60 * 1000,
            lastSentAt: now,
            studentId,
            studentName
        });

        // Send OTP email
        try {
            await sendOtpEmail(cleanEmail, studentName, otp);
        } catch (emailErr) {
            console.warn(`✉️ OTP Email delivery notice (${emailErr.message}). OTP Code generated: [${otp}]`);
        }

        console.log(`✉️ Real-Time OTP successfully sent for ${cleanEmail}: ${otp}`);
        return res.json({
            success: true,
            message: `A 6-digit OTP has been sent to ${cleanEmail}`,
            email: cleanEmail,
            studentId,
            studentName,
            expiresInSeconds: 300
        });
    } catch (error) {
        console.error('Send OTP route error:', error);
        return res.status(500).json({ success: false, error: 'OTP request failed: ' + error.message });
    }
};

const handleVerifyOtp = async (req, res) => {
    try {
        const { email, otp } = req.body;
        if (!email || !otp) {
            return res.status(400).json({ success: false, error: 'Email and 6-digit OTP code are required' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const record = otpStore.get(cleanEmail);

        if (!record) {
            return res.status(400).json({
                success: false,
                error: 'No active OTP request found for this email. Please request a new OTP.'
            });
        }

        const now = Date.now();
        if (now > record.expiresAt) {
            otpStore.delete(cleanEmail);
            return res.status(400).json({
                success: false,
                expired: true,
                error: 'OTP has expired. Please request a new OTP.'
            });
        }

        if (record.attempts >= 5) {
            otpStore.delete(cleanEmail);
            return res.status(400).json({
                success: false,
                maxAttemptsReached: true,
                error: 'Maximum OTP verification attempts (5) exceeded. Please request a new OTP.'
            });
        }

        record.attempts += 1;

        const inputHashed = crypto.createHash('sha256').update(otp.toString().trim()).digest('hex');
        if (inputHashed !== record.hashedOtp) {
            const remainingAttempts = 5 - record.attempts;
            return res.status(400).json({
                success: false,
                error: `Invalid OTP code. (${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining)`
            });
        }

        const { studentId, studentName } = record;
        otpStore.delete(cleanEmail);

        const otpToken = jwt.sign({
            email: cleanEmail,
            studentId,
            stage: 'otp_verified'
        }, JWT_SECRET, { expiresIn: '15m' });

        console.log(`✅ OTP Verification Successful for ${cleanEmail} (${studentId})`);

        return res.json({
            success: true,
            message: 'OTP verified successfully! Proceeding to Face Verification.',
            otpToken,
            student: {
                studentId,
                name: studentName,
                email: cleanEmail
            }
        });
    } catch (error) {
        console.error('Verify OTP route error:', error);
        return res.status(500).json({ success: false, error: 'OTP verification failed: ' + error.message });
    }
};

const handleResendOtp = async (req, res) => {
    try {
        const { email } = req.body;
        if (!email || !email.includes('@')) {
            return res.status(400).json({ success: false, error: 'Valid email address is required' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const existingRecord = otpStore.get(cleanEmail);
        const now = Date.now();

        const studentId = 'STU_' + cleanEmail.replace(/[^a-z0-9]/g, '_');
        const emailPrefix = cleanEmail.split('@')[0];
        const studentName = emailPrefix
            .split(/[._-]/)
            .map(w => w.charAt(0).toUpperCase() + w.slice(1))
            .join(' ');

        const newOtp = crypto.randomInt(100000, 999999).toString();
        const hashedOtp = crypto.createHash('sha256').update(newOtp).digest('hex');

        otpStore.set(cleanEmail, {
            hashedOtp,
            attempts: 0,
            expiresAt: now + 5 * 60 * 1000,
            lastSentAt: now,
            studentId,
            studentName
        });

        try {
            await sendOtpEmail(cleanEmail, studentName, newOtp);
        } catch (emailErr) {
            console.warn(`✉️ Resend OTP email notice (${emailErr.message}). Code generated: [${newOtp}]`);
        }

        console.log(`🔄 Brand new OTP generated for ${cleanEmail}: ${newOtp}`);
        return res.json({
            success: true,
            message: `A new 6-digit OTP has been sent to ${cleanEmail}`,
            email: cleanEmail,
            cooldownSeconds: 60
        });
    } catch (error) {
        console.error('Resend OTP route error:', error);
        return res.status(500).json({ success: false, error: 'Resend OTP failed: ' + error.message });
    }
};

// Route Registrations with Aliases
const { forgotPassword, resetPassword } = require('../controllers/otpController');

router.post('/auth/send-otp', handleSendOtp);
router.post('/send-otp', handleSendOtp);
router.post('/otp/send', handleSendOtp);

router.post('/auth/verify-otp', handleVerifyOtp);
router.post('/verify-otp', handleVerifyOtp);
router.post('/otp/verify', handleVerifyOtp);

router.post('/auth/resend-otp', handleResendOtp);
router.post('/resend-otp', handleResendOtp);
router.post('/otp/resend', handleResendOtp);

router.post('/auth/forgot-password', forgotPassword);
router.post('/forgot-password', forgotPassword);
router.post('/otp/forgot-password', forgotPassword);

router.post('/auth/reset-password', resetPassword);
router.post('/reset-password', resetPassword);
router.post('/otp/reset-password', resetPassword);

// =========================================================================
// STUDENT REGISTRATION & AUTHENTICATION ENDPOINTS
// =========================================================================

const handleRegister = async (req, res) => {
    console.log('📥 Received registration request:', {
        firstName: req.body?.firstName,
        lastName: req.body?.lastName,
        email: req.body?.email,
        faceEmbeddingsLength: Array.isArray(req.body?.faceEmbeddings) ? req.body.faceEmbeddings.length : 0
    });

    try {
        const { firstName, lastName, email, password, faceEmbeddings, imageSnapshot } = req.body;

        if (!firstName || !lastName || !email || !password) {
            console.warn('⚠️ Registration validation failed: Missing required fields');
            return res.status(400).json({ 
                success: false, 
                error: 'First name, last name, email, and password are required.' 
            });
        }

        if (!faceEmbeddings || !Array.isArray(faceEmbeddings) || faceEmbeddings.length === 0) {
            console.warn('⚠️ Registration validation failed: Missing faceEmbeddings array');
            return res.status(400).json({ 
                success: false, 
                error: 'Face enrollment is mandatory before registration. Please enroll your face first.' 
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        // 1. Check in-memory student cache
        if (inMemoryStudents.has(cleanEmail)) {
            return res.status(400).json({ 
                success: false, 
                error: 'An account with this email address already exists. Please login.' 
            });
        }

        // 2. Check MongoDB if connected
        let existingStudent = null;
        if (mongoose.connection.readyState === 1 && Student) {
            try {
                existingStudent = await Student.findOne({ email: cleanEmail });
            } catch (e) {
                console.warn('MongoDB Student lookup notice:', e.message);
            }
        }

        if (existingStudent) {
            return res.status(400).json({ 
                success: false, 
                error: 'An account with this email address already exists. Please login.' 
            });
        }

        const fullName = `${firstName.trim()} ${lastName.trim()}`;
        const studentId = 'STU_' + cleanEmail.replace(/[^a-z0-9]/g, '_');

        // Save webcam photo snapshot to disk folder: backend/screenshots/
        if (imageSnapshot) {
            saveImageToDisk(imageSnapshot, 'registered_student_photo', cleanEmail);
        }

        let publicProfile = {
            studentId,
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            fullName,
            name: fullName,
            email: cleanEmail,
            faceEnrolled: true,
            faceEnrolledAt: new Date(),
            registrationDate: new Date(),
            verificationStatus: 'Enrolled'
        };

        // Create student doc in MongoDB if connected
        if (mongoose.connection.readyState === 1 && Student) {
            try {
                const studentDoc = new Student({
                    studentId,
                    firstName: firstName.trim(),
                    lastName: lastName.trim(),
                    fullName,
                    name: fullName,
                    email: cleanEmail,
                    password,
                    passwordHash: password,
                    faceEmbeddings,
                    faceEnrolled: true,
                    faceEnrolledAt: new Date(),
                    registrationDate: new Date(),
                    verificationStatus: 'Enrolled'
                });
                await studentDoc.save();
                if (studentDoc.getPublicProfile) {
                    publicProfile = studentDoc.getPublicProfile();
                }
            } catch (e) {
                console.warn('MongoDB Student save notice:', e.message);
            }
        }

        // Store in memory cache
        inMemoryStudents.set(cleanEmail, {
            ...publicProfile,
            password
        });

        // Sync embedding into memory cache & FaceEmbedding collection
        const encryptedVec = encryptEmbedding(faceEmbeddings);
        inMemoryEmbeddings.set(studentId, {
            studentId,
            email: cleanEmail,
            embedding: faceEmbeddings,
            imageSnapshot: imageSnapshot || null,
            enrolledAt: new Date(),
            isActive: true
        });

        if (mongoose.connection.readyState === 1 && FaceEmbedding && FaceEmbedding.findOneAndUpdate) {
            try {
                await FaceEmbedding.findOneAndUpdate(
                    { studentId },
                    {
                        studentId,
                        email: cleanEmail,
                        embedding: faceEmbeddings,
                        encryptedEmbedding: encryptedVec,
                        imageSnapshot: imageSnapshot || null,
                        enrolledAt: new Date(),
                        isActive: true
                    },
                    { upsert: true, new: true }
                );
            } catch (e) {
                console.warn('FaceEmbedding upsert notice:', e.message);
            }
        }

        console.log(`✅ Student registered successfully: ${fullName} (${cleanEmail})`);

        const token = jwt.sign(
            { studentId, email: cleanEmail, name: fullName, role: 'Student' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        return res.status(201).json({
            success: true,
            message: 'Student account created and face enrolled successfully!',
            token,
            student: publicProfile
        });

    } catch (error) {
        console.error('Registration error:', error);
        return res.status(500).json({ success: false, error: 'Registration failed: ' + error.message });
    }
};

const handleLogin = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ success: false, error: 'Email and password are required.' });
        }

        const cleanEmail = email.trim().toLowerCase();
        let student = null;

        // Check MongoDB if connected
        if (mongoose.connection.readyState === 1 && Student) {
            try {
                student = await Student.findOne({ email: cleanEmail });
            } catch (e) {
                console.warn('MongoDB Student login lookup notice:', e.message);
            }
        }

        // Fallback to in-memory store
        if (!student && inMemoryStudents.has(cleanEmail)) {
            const cached = inMemoryStudents.get(cleanEmail);
            student = {
                studentId: cached.studentId,
                email: cached.email,
                name: cached.name,
                fullName: cached.fullName,
                comparePassword: async (pwd) => pwd === cached.password,
                getPublicProfile: () => cached
            };
        }

        if (!student) {
            // Development fallback for quick testing
            const studentId = 'STU_' + cleanEmail.replace(/[^a-z0-9]/g, '_');
            student = {
                studentId,
                email: cleanEmail,
                name: cleanEmail.split('@')[0],
                fullName: cleanEmail.split('@')[0],
                comparePassword: async () => true,
                getPublicProfile: () => ({
                    studentId,
                    email: cleanEmail,
                    name: cleanEmail.split('@')[0],
                    fullName: cleanEmail.split('@')[0]
                })
            };
        }

        if (student.comparePassword) {
            const isMatch = await student.comparePassword(password);
            if (!isMatch) {
                return res.status(401).json({ success: false, error: 'Invalid email or password.' });
            }
        }

        const token = jwt.sign(
            { 
                studentId: student.studentId, 
                email: student.email, 
                name: student.fullName || student.name, 
                role: 'Student' 
            },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        console.log(`🔑 Login password authenticated for ${cleanEmail}. Proceeding to Face Verification.`);

        const pubProfile = student.getPublicProfile ? student.getPublicProfile() : {
            studentId: student.studentId,
            email: student.email,
            name: student.fullName || student.name
        };

        return res.json({
            success: true,
            message: 'Password authenticated. Opening Face Verification...',
            token,
            requiresFaceVerification: true,
            student: pubProfile
        });

    } catch (error) {
        console.error('Login error:', error);
        return res.status(500).json({ success: false, error: 'Login failed: ' + error.message });
    }
};

// Auth Route Registrations & Aliases
router.post('/auth/register', handleRegister);
router.post('/register', handleRegister);
router.post('/user/register', handleRegister);

router.post('/auth/login', handleLogin);
router.post('/login', handleLogin);
router.post('/user/login', handleLogin);


// DEVELOPMENT MODE ONLY - REMOVE BEFORE PRODUCTION
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    const mockUser = {
        studentId: 'STU_' + Date.now(),
        name: 'Student',
        email: 'student@proctor.com',
        role: 'Student'
    };

    if (!token) {
        req.user = mockUser;
        return next();
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        req.user = mockUser;
        next();
    }
}

// =========================================================================
// FACE ENROLLMENT & VERIFICATION
// =========================================================================
// FACE ENROLLMENT & VERIFICATION
// =========================================================================

const enrollTimestamps = new Map();
const inMemoryEmbeddings = new Map();

// Secure AES-256 Cipher Key for Embedding Encryption (Requirement 9)
const ENCRYPTION_KEY = crypto.createHash('sha256').update(process.env.JWT_SECRET || 'athena-proctoring-embedding-secret').digest();

function encryptEmbedding(vectorArray) {
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        const jsonStr = JSON.stringify(vectorArray);
        let encrypted = cipher.update(jsonStr, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`;
    } catch (e) {
        return JSON.stringify(vectorArray);
    }
}

function decryptEmbedding(encryptedStr) {
    try {
        if (!encryptedStr || (typeof encryptedStr !== 'string') || !encryptedStr.includes(':')) {
            return Array.isArray(encryptedStr) ? encryptedStr : (typeof encryptedStr === 'string' ? JSON.parse(encryptedStr) : null);
        }
        const [ivHex, encryptedHex] = encryptedStr.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return JSON.parse(decrypted);
    } catch (e) {
        return null;
    }
}

const faceController = require('../controllers/faceController');

router.post('/face/enroll', faceController.enrollFace);
router.post('/face/verify', faceController.verifyFace);
router.post('/verify-face', faceController.verifyFace);
router.get('/face/debug/:studentId', faceController.getFaceDebug);

/**
 * DELETE /api/face/enrollment/:studentId
 * Check 11: Allows deleting/resetting enrollment to enable re-enrollment
 */
router.delete('/face/enrollment/:studentId', async (req, res) => {
    try {
        const { studentId } = req.params;
        const email = req.query.email || studentId;

        // Clear in-memory caches
        inMemoryEmbeddings.delete(studentId);
        inMemoryStudents.delete(studentId);

        let deletedFromDb = false;

        if (mongoose.connection.readyState === 1) {
            if (FaceEmbedding) {
                await FaceEmbedding.deleteMany({
                    $or: [{ studentId }, { email }]
                }).catch(() => {});
                deletedFromDb = true;
            }
            if (Student) {
                await Student.updateMany(
                    { $or: [{ studentId }, { email }] },
                    { $set: { faceEnrolled: false, faceEmbeddings: [], faceEnrolledAt: null } }
                ).catch(() => {});
            }
        }

        console.log(`🗑️ Enrollment deleted for studentId: ${studentId}`);
        return res.json({
            success: true,
            deletedFromDb,
            message: `Face enrollment successfully deleted for ${studentId}. You may now re-enroll.`
        });
    } catch (err) {
        console.error('Delete enrollment error:', err);
        return res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/face/enroll', async (req, res) => {
    const sId = req.body?.studentId || req.query?.studentId;
    if (sId) {
        req.params = { studentId: sId };
        return router.handle(req, res);
    }
    return res.status(400).json({ error: 'studentId required' });
});


/**
 * POST /api/incidents/log
 * Body: { studentId, fullName, email, screenshot, reason, confidence, timestamp }
 */
router.post('/incidents/log', authenticateToken, async (req, res) => {
    try {
        const { studentId, fullName, email, screenshot, reason, confidence, timestamp } = req.body;

        if (!studentId || !fullName || !email) {
            return res.status(400).json({ success: false, error: 'studentId, fullName, and email are required.' });
        }

        const incident = new Incident({
            studentId,
            fullName,
            email,
            screenshot: screenshot || null,
            reason: reason || 'Face Mismatch',
            confidence: confidence || 0,
            timestamp: timestamp ? new Date(timestamp) : new Date()
        });

        await incident.save();

        if (Student) {
            await Student.findOneAndUpdate(
                { $or: [{ studentId }, { email: email.trim().toLowerCase() }] },
                { verificationStatus: 'Terminated', lastVerification: new Date() }
            ).catch(() => {});
        }

        // Send real-time Socket.IO alert to Admin Dashboard
        const io = req.app.get('io');
        if (io) {
            io.to('admin_room').emit('incident_logged', {
                incidentId: incident._id,
                studentId,
                fullName,
                email,
                reason: incident.reason,
                confidence: incident.confidence,
                screenshot: incident.screenshot,
                timestamp: incident.timestamp,
                status: 'Identity Failed'
            });
            io.to('admin_room').emit('ai-alert', {
                type: 'IDENTITY_FAILED_AUTO_TERMINATED',
                studentId,
                studentName: fullName,
                email,
                reason: incident.reason,
                timestamp: incident.timestamp
            });
        }

        console.log(`🚨 Incident Logged & Admin Notified: ${fullName} (${reason})`);

        return res.status(201).json({
            success: true,
            message: 'Incident logged and admin notified in real time.',
            incidentId: incident._id
        });

    } catch (error) {
        console.error('Incident logging error:', error);
        return res.status(500).json({ success: false, error: 'Incident logging failed: ' + error.message });
    }
});


/**
 * GET /api/face/status/:studentId
 */
router.get('/face/status/:studentId', authenticateToken, async (req, res) => {
    try {
        const studentId = req.params.studentId;
        let isEnrolled = inMemoryEmbeddings.has(studentId);
        let enrolledAt = isEnrolled ? inMemoryEmbeddings.get(studentId).enrolledAt : null;

        if (!isEnrolled && FaceEmbedding && FaceEmbedding.findOne) {
            try {
                const dbRecord = await FaceEmbedding.findOne({
                    studentId,
                    isActive: true
                }).select('-embedding');
                if (dbRecord) {
                    isEnrolled = true;
                    enrolledAt = dbRecord.enrolledAt;
                }
            } catch (e) {}
        }

        return res.json({
            enrolled: isEnrolled,
            enrolledAt
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// =========================================================================
// EXAM SESSION
// =========================================================================

const activeSessions = new Map(); // in-memory cache

/**
 * POST /api/session/start
 * Body: { studentId, examId? }
 */
router.post('/session/start', authenticateToken, async (req, res) => {
    try {
        const { studentId, examId } = req.body;
        const sessionId = `sess_${studentId}_${Date.now()}`;

        const sessionData = {
            sessionId,
            studentId,
            examId: examId || 'general',
            startedAt: new Date(),
            status: 'active',
            violationCount: 0,
            faceVerified: false
        };

        activeSessions.set(sessionId, sessionData);

        // Notify Socket.IO if available
        const io = req.app.get('io');
        if (io) {
            io.to(`student_${studentId}`).emit('session_started', { sessionId, startedAt: sessionData.startedAt });
        }

        return res.json({ success: true, sessionId, startedAt: sessionData.startedAt });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/session/end
 * Body: { sessionId }
 */
router.post('/session/end', authenticateToken, async (req, res) => {
    try {
        const { sessionId } = req.body;
        const session = activeSessions.get(sessionId);
        if (session) {
            session.endedAt = new Date();
            session.status = 'ended';
            activeSessions.delete(sessionId);
        }

        // Count violations from DB
        const violationCount = await SuspiciousActivity.countDocuments({ sessionId });

        const io = req.app.get('io');
        if (io) {
            const studentId = session ? session.studentId : req.user.studentId;
            io.to(`student_${studentId}`).emit('session_ended', { sessionId });
        }

        return res.json({ success: true, violationCount, sessionId });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/session/active/:studentId
 */
router.get('/session/active/:studentId', authenticateToken, async (req, res) => {
    const sessions = [...activeSessions.values()].filter(
        s => s.studentId === req.params.studentId && s.status === 'active'
    );
    return res.json({ sessions });
});

// =========================================================================
// VIOLATIONS / SUSPICIOUS ACTIVITY
// =========================================================================

/**
 * POST /api/violations/log
 * Body: { studentId, sessionId, type, confidence, description, screenshotBase64, metadata }
 */
router.post('/violations/log', authenticateToken, async (req, res) => {
    try {
        const {
            studentId, studentEmail, examId, sessionId, type, confidence,
            description, screenshotBase64, screenshotPath, metadata, severity, warningNumber
        } = req.body;

        const effectiveType = type || 'MULTIPLE_FACE';
        const effectiveScreenshot = screenshotBase64 || screenshotPath || null;

        // Save violation (Requirement 7)
        const activity = new SuspiciousActivity({
            studentId: studentId || ('STU_' + Date.now()),
            studentEmail: studentEmail || req.user?.email || null,
            examId: examId || 'CS_EXAM_FINAL',
            violationType: effectiveType,
            warningNumber: warningNumber || 0,
            screenshotPath: effectiveScreenshot,
            sessionId: sessionId || `sess_${studentId}_${Date.now()}`,
            type: effectiveType,
            confidence: confidence || null,
            description: description || '',
            screenshotBase64: effectiveScreenshot,
            metadata: metadata || {},
            severity: severity || (warningNumber >= 3 ? 'critical' : 'high'),
            timestamp: new Date()
        });
        await activity.save();

        // Save screenshot evidence separately if provided
        if (effectiveScreenshot) {
            const sizeKb = Math.round((effectiveScreenshot.length * 3) / 4 / 1024);
            await new ScreenshotEvidence({
                activityId: activity._id,
                sessionId: activity.sessionId,
                studentId: activity.studentId,
                imageBase64: effectiveScreenshot,
                fileSizeKb: sizeKb,
                savedAt: new Date()
            }).save().catch(() => {});
        }

        // Update in-memory session violation count
        if (activity.sessionId) {
            const session = activeSessions.get(activity.sessionId);
            if (session) session.violationCount++;
        }

        // Broadcast via Socket.IO (Requirement 4 & 6)
        const io = req.app.get('io');
        if (io) {
            const payload = {
                id: activity._id,
                type: effectiveType,
                violationType: effectiveType,
                warningNumber: warningNumber || 0,
                warningText: `${warningNumber || 0} / 3`,
                studentId: activity.studentId,
                studentEmail: activity.studentEmail,
                examId: activity.examId,
                confidence,
                description,
                severity: activity.severity,
                screenshot: effectiveScreenshot,
                timestamp: activity.timestamp,
                status: (warningNumber >= 3) ? 'Exam Terminated' : 'Exam Active'
            };
            io.emit('multi-face-violation', payload);
            io.to('teacher_room').emit('violation', payload);
            if (warningNumber >= 3) {
                io.emit('exam_terminated', { studentId: activity.studentId, studentEmail: activity.studentEmail, reason: '3 Confirmed Multi-Face Violations' });
            }
        }

        return res.json({ success: true, activityId: activity._id, warningNumber: activity.warningNumber });
    } catch (error) {
        console.error('Log violation error:', error);
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/violations/:sessionId
 */
router.get('/violations/:sessionId', authenticateToken, async (req, res) => {
    try {
        const violations = await SuspiciousActivity.find({ sessionId: req.params.sessionId })
            .sort({ timestamp: -1 })
            .select('-screenshotBase64') // don't send large base64 in list
            .limit(100);

        return res.json({ violations, total: violations.length });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/violations/student/:studentId
 */
router.get('/violations/student/:studentId', authenticateToken, async (req, res) => {
    try {
        const violations = await SuspiciousActivity.find({ studentId: req.params.studentId })
            .sort({ timestamp: -1 })
            .select('-screenshotBase64')
            .limit(200);

        return res.json({ violations, total: violations.length });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/violations/screenshot/:activityId
 * Returns base64 screenshot for a specific activity
 */
router.get('/violations/screenshot/:activityId', authenticateToken, async (req, res) => {
    try {
        const activity = await SuspiciousActivity.findById(req.params.activityId)
            .select('screenshotBase64');
        if (!activity) return res.status(404).json({ error: 'Activity not found' });
        return res.json({ screenshotBase64: activity.screenshotBase64 });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// =========================================================================
// YOLO DETECTION PROXY
// =========================================================================

/**
 * POST /api/detect/phone
 * Proxies to Python YOLOv8 microservice (with COCO-SSD fallback)
 */
router.post('/detect/phone', authenticateToken, async (req, res) => {
    try {
        const { imageBase64, confidence_threshold } = req.body;

        try {
            const response = await axios.post(
                `${PYTHON_DETECTOR_URL}/detect/phone`,
                { imageBase64, confidence_threshold: confidence_threshold || 0.35 },
                { timeout: 5000 }
            );
            return res.json(response.data);
        } catch (pyErr) {
            // Python service not available - return graceful fallback
            return res.json({
                detected: false,
                detections: [],
                model: 'python_unavailable',
                yolo_available: false,
                message: 'Python detector offline. Using client-side COCO-SSD.'
            });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/detect/headphone
 */
router.post('/detect/headphone', authenticateToken, async (req, res) => {
    try {
        const { imageBase64, confidence_threshold } = req.body;

        try {
            const response = await axios.post(
                `${PYTHON_DETECTOR_URL}/detect/headphone`,
                { imageBase64, confidence_threshold: confidence_threshold || 0.35 },
                { timeout: 5000 }
            );
            return res.json(response.data);
        } catch (pyErr) {
            return res.json({
                detected: false,
                detections: [],
                model: 'python_unavailable',
                yolo_available: false,
                message: 'Python detector offline.'
            });
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

// =========================================================================
// HEAD & EYE MOVEMENT TELEMETRY ENDPOINTS
// =========================================================================

/**
 * POST /api/head-movement
 * Body: { studentId, sessionId, pitch, yaw, roll, direction, isHeadDown, detectionResults }
 */
router.post('/head-movement', authenticateToken, async (req, res) => {
    try {
        const {
            studentId = req.user?.studentId || ('STU_' + Date.now()),
            sessionId = 'demo_session',
            pitch = 0,
            yaw = 0,
            roll = 0,
            direction = 'Center',
            isHeadDown = false,
            detectionResults = {}
        } = req.body;

        const isViolation = direction !== 'Center' || isHeadDown;
        const violations = [];

        if (isHeadDown) {
            violations.push({
                type: 'head_down',
                severity: 'medium',
                message: 'Head tilted down continuously — potential notes or phone usage',
                timestamp: new Date()
            });
        } else if (direction === 'Left' || direction === 'Right') {
            violations.push({
                type: 'looking_away',
                severity: 'medium',
                message: `Head turned ${direction.toUpperCase()} away from screen`,
                timestamp: new Date()
            });
        }

        // Save violations to database if present
        for (const v of violations) {
            try {
                await new SuspiciousActivity({
                    studentId,
                    sessionId,
                    type: v.type,
                    severity: v.severity,
                    description: v.message,
                    metadata: { pitch, yaw, roll, direction, isHeadDown, ...detectionResults },
                    timestamp: v.timestamp
                }).save();
            } catch (e) {
                console.warn('SuspiciousActivity DB save warning:', e.message);
            }
        }

        return res.json({
            success: true,
            headMovement: {
                direction,
                isHeadDown,
                pitch,
                yaw,
                roll,
                violations,
                timestamp: new Date().toISOString()
            }
        });
    } catch (error) {
        console.error('Head movement route error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/eye-movement
 * Body: { studentId, sessionId, direction, hRatio, vRatio, blinkCount }
 */
router.post('/eye-movement', authenticateToken, async (req, res) => {
    try {
        const {
            studentId = req.user?.studentId || ('STU_' + Date.now()),
            sessionId = 'demo_session',
            direction = 'center',
            hRatio = 0.5,
            vRatio = 0.5,
            blinkCount = 0
        } = req.body;

        const isOffCenter = direction !== 'center' && direction !== 'blinking';
        let activitySaved = null;

        if (isOffCenter) {
            try {
                activitySaved = await new SuspiciousActivity({
                    studentId,
                    sessionId,
                    type: 'eye_movement',
                    severity: 'medium',
                    description: `Eye gaze off-center: looking ${direction.toUpperCase()}`,
                    metadata: { direction, hRatio, vRatio, blinkCount },
                    timestamp: new Date()
                }).save();
            } catch (e) {
                console.warn('Eye movement DB save warning:', e.message);
            }
        }

        return res.json({
            success: true,
            gaze: {
                direction,
                hRatio,
                vRatio,
                blinkCount,
                recordedViolation: !!activitySaved
            }
        });
    } catch (error) {
        console.error('Eye movement route error:', error);
        return res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// UTILITIES
// =========================================================================

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

function euclideanDistance(a, b) {
    if (a.length !== b.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < a.length; i++) {
        sum += Math.pow(a[i] - b[i], 2);
    }
    return Math.sqrt(sum);
}

module.exports = router;
