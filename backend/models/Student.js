const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const studentSchema = new mongoose.Schema({
    studentId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    course: { type: String, required: true },
    semester: { type: String, required: true },
    profilePicture: { type: String },
    isActive: { type: Boolean, default: true },
    faceEnrolled: { type: Boolean, default: false },
    faceEnrolledAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
    lastLogin: { type: Date }
});

// Hash password before saving
studentSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error) {
        next(error);
    }
});

// Method to compare password
studentSchema.methods.comparePassword = async function(candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

// Method to get public profile (remove sensitive info)
studentSchema.methods.getPublicProfile = function() {
    return {
        studentId: this.studentId,
        name: this.name,
        email: this.email,
        course: this.course,
        semester: this.semester,
        faceEnrolled: this.faceEnrolled,
        createdAt: this.createdAt
    };
};

module.exports = mongoose.model('Student', studentSchema);