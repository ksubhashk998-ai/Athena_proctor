const express = require('express');
const router = express.Router();
const {
  loginAdmin,
  getLiveStudents,
  getStudentDetail,
  getReports,
  getAnalytics,
  getAlerts,
  upsertLiveSession
} = require('../controllers/adminController');

const { verifyAdminToken } = require('../middleware/adminAuthMiddleware');

// Public / Student Routes
router.post('/login', loginAdmin);
router.post('/live-session', upsertLiveSession);
router.get('/students/live', getLiveStudents);

// Protected Admin Routes
router.get('/student/:id', verifyAdminToken, getStudentDetail);
router.get('/reports', verifyAdminToken, getReports);
router.get('/analytics', verifyAdminToken, getAnalytics);
router.get('/alerts', verifyAdminToken, getAlerts);

module.exports = router;

