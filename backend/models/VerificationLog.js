const mongoose = require('mongoose');

const VerificationLogSchema = new mongoose.Schema({
    studentId: { type: String, required: true },
    name: { type: String },
    email: { type: String },
    verificationResult: { 
        type: String, 
        enum: ['VERIFIED', 'SUSPICIOUS', 'REJECT'], 
        required: true 
    },
    similarityScore: { type: Number, required: true },
    averageSimilarity: { type: Number },
    bestSimilarity: { type: Number },
    majorityVote: { type: String },
    timestamp: { type: Date, default: Date.now },
    screenshotUrl: { type: String },
    antiSpoofingDetails: {
        blinkDetected: { type: Boolean, default: true },
        headMovementDetected: { type: Boolean, default: true },
        photoAttackPassed: { type: Boolean, default: true },
        phoneScreenPassed: { type: Boolean, default: true }
    }
}, { timestamps: true });

module.exports = mongoose.models.VerificationLog || mongoose.model('VerificationLog', VerificationLogSchema);
