const jwt = require('jsonwebtoken');
const Admin = require('../models/Admin');

const verifyAdminToken = async (req, res, next) => {
  try {
    let token;
    
    // Check Authorization header
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies && req.cookies.adminToken) {
      token = req.cookies.adminToken;
    }

    if (!token) {
      return res.status(401).json({
        success: false,
        error: 'Access denied. Admin authorization token missing.'
      });
    }

    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this-in-production';
    const decoded = jwt.verify(token, JWT_SECRET);

    // Verify role if encoded in token
    if (decoded.role && !['superadmin', 'admin', 'proctor'].includes(decoded.role)) {
      return res.status(403).json({
        success: false,
        error: 'Access forbidden. Admin privileges required.'
      });
    }

    // Try finding admin in DB if admin ID exists
    if (decoded.id) {
      const admin = await Admin.findById(decoded.id).select('-password');
      if (admin) {
        req.admin = admin;
      } else {
        req.admin = decoded;
      }
    } else {
      req.admin = decoded;
    }

    next();
  } catch (error) {
    console.error('Admin Auth Middleware Error:', error.message);
    return res.status(401).json({
      success: false,
      error: 'Invalid or expired admin token.'
    });
  }
};

module.exports = { verifyAdminToken };
