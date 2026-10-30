const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
  alertId: {
    type: String,
    required: true,
    unique: true,
    default: () => `ALT_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
  },
  sessionId: {
    type: String,
    default: () => `sess_${Date.now()}`
  },
  studentId: {
    type: String,
    required: true
  },
  studentName: {
    type: String,
    default: 'Student'
  },
  examName: {
    type: String,
    default: 'Computer Science Final Assessment'
  },
  alertType: {
    type: String,
    required: true,
    default: 'SUSPICIOUS_ACTIVITY'
  },
  message: {
    type: String,
    required: true
  },
  severity: {
    type: String,
    default: 'High'
  },
  isRead: {
    type: Boolean,
    default: false
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'alerts'
});

alertSchema.index({ alertId: 1 });
alertSchema.index({ sessionId: 1 });
alertSchema.index({ isRead: 1 });
alertSchema.index({ timestamp: -1 });

module.exports = mongoose.models.Alert || mongoose.model('Alert', alertSchema);
