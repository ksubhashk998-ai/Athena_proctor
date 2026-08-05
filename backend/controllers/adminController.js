const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const Admin = require('../models/Admin');
const LiveSession = require('../models/LiveSession');
const ExamReport = require('../models/ExamReport');
const Violation = require('../models/Violation');
const Alert = require('../models/Alert');
const ScreenshotEvidence = require('../models/ScreenshotEvidence');
const SuspiciousActivity = require('../models/SuspiciousActivity');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';

/**
 * 1. Admin Login
 * POST /api/admin/login
 */
const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        error: 'Please provide both email and password'
      });
    }

    let admin = await Admin.findOne({ email: email.toLowerCase() });

    // Fallback: If default admin credentials used and admin doesn't exist yet, auto-create
    if (!admin && email.toLowerCase() === 'admin@proctor.com' && password === 'Admin@123') {
      admin = await Admin.create({
        name: 'System Administrator',
        email: 'admin@proctor.com',
        password: 'Admin@123',
        role: 'superadmin',
        department: 'Exam Control Center'
      });
    }

    if (!admin) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Admin account not found.'
      });
    }

    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        error: 'Invalid credentials. Password incorrect.'
      });
    }

    // Update last login
    admin.lastLogin = new Date();
    await admin.save();

    // Create JWT Token
    const token = jwt.sign(
      {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        department: admin.department
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      message: 'Admin login successful',
      token,
      admin: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        department: admin.department
      }
    });
  } catch (error) {
    console.error('Error in loginAdmin:', error);
    res.status(500).json({
      success: false,
      error: 'Server error during admin authentication: ' + error.message
    });
  }
};

/**
 * Helper to purge any legacy mock/demo student sessions from database and mark stale sessions offline
 */
const purgeLegacyMockSessions = async () => {
  try {
    const activeCutoff = new Date(Date.now() - 30 * 1000);
    await LiveSession.deleteMany({
      $or: [
        { studentId: { $in: ['STU-001', 'STU-002', 'STU-003', 'STU_KCS998', 'SESS-1000', 'SESS-1001', 'SESS-1002', 'SESS-1003', 'STU_ksubhashk998_gmail_com', 'SESS-STU_ksubhashk998_gmail_com'] } },
        { email: { $in: ['alex.j@university.edu', 'sophia.w@university.edu', 'ethan.b@university.edu', 'ksubhashk998@gmail.com', 'demo@student.com'] } },
        { studentName: { $in: ['Alex Johnson', 'Sophia Williams', 'Ethan Brown', 'K. Subhash', 'Ksubhashk998'] } },
        { lastActive: { $lt: activeCutoff } },
        { lastActive: { $exists: false } }
      ]
    });
  } catch (err) {
    console.error('Error purging mock sessions:', err.message);
  }
};

/**
 * 2. Live Student Monitoring
 * GET /api/admin/students/live
 */
const getLiveStudents = async (req, res) => {
  try {
    console.log('🔥 GET LIVE STUDENTS HIT! Purging and filtering...');
    await LiveSession.deleteMany({
      $or: [
        { studentId: { $in: ['STU-001', 'STU-002', 'STU-003', 'STU_KCS998', 'SESS-1000', 'SESS-1001', 'SESS-1002', 'SESS-1003', 'STU_ksubhashk998_gmail_com', 'SESS-STU_ksubhashk998_gmail_com'] } },
        { email: { $in: ['alex.j@university.edu', 'sophia.w@university.edu', 'ethan.b@university.edu', 'ksubhashk998@gmail.com', 'demo@student.com'] } },
        { studentName: { $in: ['Alex Johnson', 'Sophia Williams', 'Ethan Brown', 'K. Subhash', 'Ksubhashk998'] } }
      ]
    });

    const { search, riskLevel, status, department } = req.query;

    const allSessions = await LiveSession.find({}).lean();
    const activeCutoffTime = Date.now() - 30 * 1000;

    const students = allSessions.filter(s => {
      // Must be Online
      const matchesStatus = status ? s.status === status : s.status === 'Online';
      if (!matchesStatus) return false;

      // Must have active telemetry within last 30s
      const lastActiveTime = s.lastActive ? new Date(s.lastActive).getTime() : 0;
      if (lastActiveTime < activeCutoffTime) return false;

      if (riskLevel && s.riskLevel !== riskLevel) return false;
      if (department && s.department !== department) return false;
      if (search) {
        const q = search.toLowerCase();
        const nameMatch = s.studentName && s.studentName.toLowerCase().includes(q);
        const usnMatch = s.usn && s.usn.toLowerCase().includes(q);
        const emailMatch = s.email && s.email.toLowerCase().includes(q);
        const examMatch = s.examName && s.examName.toLowerCase().includes(q);
        if (!nameMatch && !usnMatch && !emailMatch && !examMatch) return false;
      }
      return true;
    });

    res.json({
      success: true,
      count: students.length,
      students
    });
  } catch (error) {
    console.error('Error in getLiveStudents:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch live students: ' + error.message
    });
  }
};


/**
 * 3. Student Detail Page
 * GET /api/admin/student/:id
 */
const getStudentDetail = async (req, res) => {
  try {
    const studentIdentifier = req.params.id;

    // Search by sessionId, studentId, or _id
    let session = await LiveSession.findOne({
      $or: [
        { sessionId: studentIdentifier },
        { studentId: studentIdentifier },
        ...(studentIdentifier.match(/^[0-9a-fA-F]{24}$/) ? [{ _id: studentIdentifier }] : [])
      ]
    });

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Student session not found'
      });
    }

    // Fetch related violations, alerts, and captured screenshot evidence
    const violations = await Violation.find({
      $or: [
        { sessionId: session.sessionId },
        { studentId: session.studentId }
      ]
    }).sort({ timestamp: -1 });

    const alerts = await Alert.find({
      $or: [
        { sessionId: session.sessionId },
        { studentId: session.studentId }
      ]
    }).sort({ timestamp: -1 });

    const evidenceDocs = await ScreenshotEvidence.find({
      $or: [
        { sessionId: session.sessionId },
        { studentId: session.studentId }
      ]
    }).sort({ createdAt: -1 }).limit(20);

    const suspiciousDocs = await SuspiciousActivity.find({
      $or: [
        { sessionId: session.sessionId },
        { studentId: session.studentId }
      ],
      screenshotBase64: { $exists: true, $ne: null }
    }).sort({ timestamp: -1 }).limit(20);

    const screenshotsCaptured = [];

    // 1. Live Proctoring Frame Snapshot
    if (session.lastWebcamFrame) {
      screenshotsCaptured.push({
        url: session.lastWebcamFrame,
        reason: '📸 Automated Proctoring Live Snapshot',
        timestamp: session.updatedAt || new Date(),
        confidence: '99.0%',
        severity: 'Normal'
      });
    }

    // 2. Suspicious Activity Frame Captures
    suspiciousDocs.forEach(sa => {
      screenshotsCaptured.push({
        url: sa.screenshotBase64,
        reason: `${sa.type?.replace(/_/g, ' ').toUpperCase() || 'Proctor Violation Frame'}`,
        timestamp: sa.timestamp,
        confidence: sa.confidence ? `${(sa.confidence * 100).toFixed(1)}%` : 'Verified',
        severity: sa.severity || 'Medium'
      });
    });

    // 3. Screenshot Evidence Collection
    evidenceDocs.forEach(e => {
      screenshotsCaptured.push({
        url: e.imageBase64,
        reason: 'Automated Anomaly Evidence',
        timestamp: e.savedAt || e.createdAt,
        sizeKb: e.fileSizeKb || 0
      });
    });

    const studentObj = {
      ...session.toObject(),
      screenshotsCaptured
    };

    res.json({
      success: true,
      student: studentObj,
      violations,
      alerts
    });
  } catch (error) {
    console.error('Error in getStudentDetail:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch student details: ' + error.message
    });
  }
};

/**
 * 4. Reports API
 * GET /api/admin/reports
 */
const getReports = async (req, res) => {
  try {
    const { search, examName, riskLevel, page = 1, limit = 50 } = req.query;

    const query = {};
    if (riskLevel) query.riskLevel = riskLevel;
    if (examName) query.examName = { $regex: examName, $options: 'i' };
    if (search) {
      query.$or = [
        { studentName: { $regex: search, $options: 'i' } },
        { usn: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { reportId: { $regex: search, $options: 'i' } }
      ];
    }

    const reports = await ExamReport.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    const totalReports = await ExamReport.countDocuments(query);

    res.json({
      success: true,
      total: totalReports,
      page: Number(page),
      reports
    });
  } catch (error) {
    console.error('Error in getReports:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch exam reports: ' + error.message
    });
  }
};

/**
 * 5. Dashboard Analytics API
 * GET /api/admin/analytics
 */
const getAnalytics = async (req, res) => {
  try {
    await purgeLegacyMockSessions();

    const allSessions = await LiveSession.find();
    const activeCutoffTime = Date.now() - 20 * 1000;
    const activeSessions = allSessions.filter(s => {
      if (s.status !== 'Online') return false;
      const lastActiveTime = s.lastActive ? new Date(s.lastActive).getTime() : 0;
      return lastActiveTime >= activeCutoffTime;
    });

    // Group active exams
    const activeExamsSet = new Set(activeSessions.map(s => s.examName).filter(Boolean));
    const activeExamsCount = activeExamsSet.size;

    const activeStudentsCount = activeSessions.filter(s => s.status === 'Online').length;

    const highRiskStudentsCount = activeSessions.filter(s => s.riskLevel === 'High').length;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const violationsTodayCount = await Violation.countDocuments({
      timestamp: { $gte: today }
    }) || activeSessions.reduce((acc, s) => acc + (s.suspiciousActivityCount || 0), 0);

    const examsCompletedCount = await ExamReport.countDocuments();

    // Charts Data Generation
    const riskDistribution = {
      Low: activeSessions.filter(s => s.riskLevel === 'Low').length,
      Medium: activeSessions.filter(s => s.riskLevel === 'Medium').length,
      High: activeSessions.filter(s => s.riskLevel === 'High').length
    };

    const violationsBreakdown = [
      { name: 'Mobile Phone', count: activeSessions.filter(s => s.mobilePhoneDetected).length },
      { name: 'Multiple Faces', count: activeSessions.filter(s => s.multipleFaces).length },
      { name: 'Tab Switches', count: activeSessions.reduce((acc, s) => acc + (s.tabSwitchingCount || 0), 0) },
      { name: 'Copy/Paste', count: activeSessions.reduce((acc, s) => acc + (s.copyPasteAttempts || 0), 0) },
      { name: 'Looking Away', count: activeSessions.filter(s => s.headPose && s.headPose !== 'Normal').length }
    ];

    res.json({
      success: true,
      metrics: {
        activeExams: activeExamsCount,
        activeStudents: activeStudentsCount,
        violationsToday: violationsTodayCount,
        highRiskStudents: highRiskStudentsCount,
        examsCompleted: examsCompletedCount
      },
      charts: {
        riskDistribution,
        violationsBreakdown
      }
    });
  } catch (error) {
    console.error('Error in getAnalytics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch analytics: ' + error.message
    });
  }
};

/**
 * 6. Live Alerts API
 * GET /api/admin/alerts
 */
const getAlerts = async (req, res) => {
  try {
    const alerts = await Alert.find().sort({ timestamp: -1 }).limit(50);

    res.json({
      success: true,
      count: alerts.length,
      alerts
    });
  } catch (error) {
    console.error('Error in getAlerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alerts: ' + error.message
    });
  }
};

/**
 * 7. Upsert Live Student Session (Called by Student App or Socket)
 * POST /api/admin/live-session
 */
const upsertLiveSession = async (req, res) => {
  try {
    const {
      studentId,
      studentName,
      usn,
      email,
      examId,
      examName,
      department,
      status,
      faceDetected,
      multipleFaces,
      mobilePhoneDetected,
      headPose,
      eyeGaze,
      tabSwitchingCount,
      copyPasteAttempts,
      fullScreenStatus,
      internetStatus,
      suspiciousActivityCount,
      riskLevel,
      eventLog
    } = req.body;

    const sId = studentId || (req.user && req.user.studentId) || 'STU-001';
    const sName = studentName || (req.user && req.user.name) || 'Student';
    const sEmail = email || (req.user && req.user.email) || 'student@university.edu';
    const sUsn = usn || sId;

    let session = await LiveSession.findOne({ studentId: sId });

    if (!session) {
      session = new LiveSession({
        sessionId: req.body.sessionId || `SESS-${sId}`,
        studentId: sId,
        studentName: sName,
        usn: sUsn,
        email: sEmail,
        examId: examId || 'CS-401',
        examName: examName || 'Advanced Data Structures & Algorithms',
        department: department || 'Computer Science & Engineering',
        startTime: new Date(),
        status: status || 'Online',
        riskLevel: riskLevel || 'Low'
      });
    }

    if (status) session.status = status;
    if (faceDetected !== undefined) session.faceDetected = faceDetected;
    if (multipleFaces !== undefined) session.multipleFaces = multipleFaces;
    if (mobilePhoneDetected !== undefined) session.mobilePhoneDetected = mobilePhoneDetected;
    if (headPose) session.headPose = headPose;
    if (eyeGaze) session.eyeGaze = eyeGaze;
    if (tabSwitchingCount !== undefined) session.tabSwitchingCount = tabSwitchingCount;
    if (copyPasteAttempts !== undefined) session.copyPasteAttempts = copyPasteAttempts;
    if (fullScreenStatus) session.fullScreenStatus = fullScreenStatus;
    if (req.body.lastWebcamFrame || req.body.image) {
      session.lastWebcamFrame = req.body.lastWebcamFrame || req.body.image;
    }
    session.lastActive = new Date();

    if (eventLog) {
      session.eventLogs.push({
        event: eventLog.event || 'LOG',
        severity: eventLog.severity || 'Info',
        details: eventLog.details || 'Activity recorded',
        timestamp: new Date()
      });
    }

    await session.save();

    // Broadcast live session update via Socket.IO if attached
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('student-updated', session);
      io.to('admin_room').emit('live-students-updated', session);
    }

    res.json({
      success: true,
      message: 'Live session updated successfully',
      session
    });
  } catch (error) {
    console.error('Error in upsertLiveSession:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update live session: ' + error.message
    });
  }
};

module.exports = {
  loginAdmin,
  getLiveStudents,
  getStudentDetail,
  getReports,
  getAnalytics,
  getAlerts,
  upsertLiveSession
};

