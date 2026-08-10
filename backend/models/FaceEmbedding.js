const mongoose = require('mongoose');

const faceEmbeddingSchema = new mongoose.Schema({
    studentId: {
        type: String,
        required: true,
        unique: true,
        ref: 'Student'
    },
    name: {
        type: String,
        required: false
    },
    email: {
        type: String,
        required: false,
        index: true
    },
    faceEnrolled: {
        type: Boolean,
        default: true
    },
    enrollmentImages: {
        type: [String], // 30 face samples (Specification Enrollment)
        default: []
    },
    embeddings: {
        type: [[Number]], // 30 ArcFace 128-d or 512-d embedding vectors
        default: []
    },
    encryptedEmbeddings: {
        type: [String], // 30 AES-256 cipher strings
        default: []
    },
    embedding: {
        type: [Number], // Primary centroid vector
        default: []
    },
    encryptedEmbedding: {
        type: String,
        default: null
    },
    imageSnapshot: {
        type: String,
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true });

module.exports = mongoose.model('FaceEmbedding', faceEmbeddingSchema);

