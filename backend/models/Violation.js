const mongoose = require('mongoose');

const violationSchema = new mongoose.Schema({
  violationId: {
    type: String,
    required: true,
    unique: true,
    default: () => `VIOL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
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
  type: {
    type: String,
    required: true,
    default: 'SUSPICIOUS_BEHAVIOR'
  },
  description: {
    type: String,
    required: true,
    default: 'Proctoring violation detected'
  },
  severity: {
    type: String,
    default: 'Medium'
  },
  screenshotUrl: {
    type: String,
    default: ''
  },
  metadata: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'violations'
});

violationSchema.index({ violationId: 1 });
violationSchema.index({ sessionId: 1 });
violationSchema.index({ studentId: 1 });
violationSchema.index({ type: 1 });
violationSchema.index({ timestamp: -1 });

module.exports = mongoose.models.Violation || mongoose.model('Violation', violationSchema);
