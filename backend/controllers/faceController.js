const faceService = require('../services/faceService.js');
const User = require('../models/userModel.js');

const registerFace = async (req, res) => {
    try {
        const { userId, faceImages } = req.body;
        if (!userId || !faceImages || faceImages.length < 1) {
            return res.status(400).json({ error: 'User ID and face images required' });
        }
        const result = await faceService.registerFace(userId, faceImages);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const verifyFace = async (req, res) => {
    try {
        const { userId, faceImage } = req.body;
        if (!userId || !faceImage) {
            return res.status(400).json({ error: 'User ID and face image required' });
        }
        const result = await faceService.verifyFace(userId, faceImage);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const detectFace = async (req, res) => {
    try {
        const { faceImage } = req.body;
        const result = await faceService.detectFace(faceImage);
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

const getFaceStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const status = await faceService.getFaceStatus(userId);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
};

module.exports = {
    registerFace,
    verifyFace,
    detectFace,
    getFaceStatus
};