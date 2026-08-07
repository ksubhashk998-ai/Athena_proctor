const mongoose = require('mongoose');

const FaceProfileSchema = new mongoose.Schema({
    studentId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    enrollmentImages: [{ type: String }],
    embeddings: [[Number]],
    createdAt: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.models.FaceProfile || mongoose.model('FaceProfile', FaceProfileSchema);
