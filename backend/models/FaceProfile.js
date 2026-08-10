const mongoose = require('mongoose');

const FaceProfileSchema = new mongoose.Schema({
    studentId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    enrollmentImages: [{ type: String }],
    embeddings: [[Number]], // Array of all 30 (or >=25) 512d L2-normalized embeddings
    averageEmbedding: [Number], // 512d mean normalized embedding
    enrollmentDate: { type: Date, default: Date.now },
    modelVersion: { type: String, default: 'InsightFace-ArcFace' }
}, { timestamps: true });

module.exports = mongoose.models.FaceProfile || mongoose.model('FaceProfile', FaceProfileSchema);

