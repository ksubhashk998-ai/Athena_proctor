const mongoose = require('mongoose');

const faceEmbeddingSchema = new mongoose.Schema({
    studentId: {
        type: String,
        required: true,
        unique: true,
        ref: 'Student'
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
    enrollmentDate: {
        type: Date,
        default: Date.now
    },
    embeddingVersion: {
        type: String,
        default: 'ArcFace-v1.0'
    },
    embedding: {
        type: [Number],
        required: false,
        validate: {
            validator: function(v) {
                return !v || v.length === 0 || v.length === 128 || v.length === 512;
            },
            message: 'Face embedding must be a 128 or 512-dimensional vector'
        }
    },
    encryptedEmbedding: {
        type: String, // Encrypted AES-256 cipher string (Requirement 9)
        default: null
    },
    enrolledAt: {
        type: Date,
        default: Date.now
    },
    imageSnapshot: {
        type: String, // base64 thumbnail
        default: null
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, { timestamps: true });

module.exports = mongoose.model('FaceEmbedding', faceEmbeddingSchema);
