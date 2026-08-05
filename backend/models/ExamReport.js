const mongoose = require('mongoose');

const examReportSchema = new mongoose.Schema({
  reportId: {
    type: String,
    required: true,
    unique: true
  },
  studentId: {
    type: String,
    required: true
  },
  studentName: {
    type: String,
    required: true
  },
  usn: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: true
  },
  examId: {
    type: String,
    required: true
  },
  examName: {
    type: String,
    required: true
  },
  department: {
    type: String,
    default: 'Computer Science & Engineering'
  },
  startTime: {
    type: Date,
    required: true
  },
  endTime: {
    type: Date,
    default: Date.now
  },
  totalDurationMinutes: {
    type: Number,
    default: 180
  },
  score: {
    type: Number,
    default: 0
  },
  totalViolations: {
    type: Number,
    default: 0
  },
  suspiciousCount: {
    type: Number,
    default: 0
  },
  riskLevel: {
    type: String,
    enum: ['Low', 'Medium', 'High'],
    default: 'Low'
  },
  cheatingScore: {
    type: Number, // 0 to 100 percentage
    default: 0
  },
  status: {
    type: String,
    enum: ['Submitted', 'Auto-Terminated', 'Under Review', 'Verified'],
    default: 'Submitted'
  },
  summary: {
    type: String,
    default: 'Exam completed successfully with normal proctoring metrics.'
  },
  violationsSummary: {
    tabSwitches: { type: Number, default: 0 },
    multipleFaces: { type: Number, default: 0 },
    mobileDetections: { type: Number, default: 0 },
    cameraAbsences: { type: Number, default: 0 },
    copyPasteAttempts: { type: Number, default: 0 }
  },
  violations: [{
    type: { type: String },
    description: String,
    severity: String,
    timestamp: Date,
    screenshotUrl: String
  }],
  logs: [{
    event: String,
    severity: String,
    details: String,
    timestamp: Date
  }],
  screenshots: [{
    url: String,
    reason: String,
    timestamp: Date
  }]
}, {
  timestamps: true,
  collection: 'exam_reports'
});

examReportSchema.index({ reportId: 1 });
examReportSchema.index({ studentId: 1 });
examReportSchema.index({ examId: 1 });
examReportSchema.index({ riskLevel: 1 });

module.exports = mongoose.models.ExamReport || mongoose.model('ExamReport', examReportSchema);
