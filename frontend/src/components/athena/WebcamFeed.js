import React, { useEffect, useRef, useState } from 'react';
import proctoringPipeline from '../../services/proctoringPipeline';
import { getSocket } from '../../services/socketService';

function WebcamFeed({ isProctoringActive, onDetectionUpdate, onViolationTriggered }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [modelStatus, setModelStatus] = useState('Initializing MediaPipe Face Mesh...');
  const lastViolationTimes = useRef({});

  // ── 1. Initialize Webcam Stream ─────────────────────────────
  useEffect(() => {
    let stream = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: 640, height: 480, frameRate: { ideal: 30 } },
          audio: false,
        });
        if (videoRef.current && videoRef.current.srcObject !== stream) {
          videoRef.current.srcObject = stream;
          const p = videoRef.current.play();
          if (p !== undefined) {
            p.catch(err => {
              if (err.name !== 'AbortError' && !err.message?.includes('interrupted')) {
                console.warn('Video play warning:', err.message);
              }
            });
          }
        }
      } catch (err) {
        console.warn('Webcam stream error:', err);
      }
    }

    startCamera();
    return () => { if (stream) stream.getTracks().forEach(t => t.stop()); };
  }, []);

  // ── 2. Initialize MediaPipe Face Mesh + COCO-SSD ─────────────
  useEffect(() => {
    let mounted = true;
    proctoringPipeline.initialize().then(ok => {
      if (mounted) {
        setModelStatus(ok
          ? 'MediaPipe Face Mesh + COCO-SSD Active'
          : 'Fallback Vision Engine Active');
      }
    });
    return () => { mounted = false; };
  }, []);

  // ── 3. Violation helper (3.5s cooldown per type) ─────────────
  const triggerViolation = (type, details) => {
    const now = Date.now();
    if (now - (lastViolationTimes.current[type] || 0) > 3500) {
      lastViolationTimes.current[type] = now;
      if (onViolationTriggered) onViolationTriggered(type, details);
    }
  };

  // ── 4. Frame Detection Loop (every 300ms) ────────────────────
  useEffect(() => {
    if (!isProctoringActive) return;

    const intervalId = setInterval(async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) return;

      const t = await proctoringPipeline.processFrame(video, canvas);

      // Violations
      if (t.phoneTrigger)
        triggerViolation('phone_detected', `📱 Phone Detected (${t.phoneScore}%, ${t.phoneTrackSec}s)`);
      if (t.earphoneTrigger)
        triggerViolation('earphones_detected', `🎧 Earphones Detected (${t.earphonesScore}%)`);
      if (t.faceMissingTrigger)
        triggerViolation('no_face', '⚠️ Candidate face absent > 3 continuous seconds');
      if (t.multiFaceTrigger)
        triggerViolation('multiple_faces', `👥 Multiple Faces (${t.personCount}) for > 2 seconds`);
      if (t.gazeAwayTrigger)
        triggerViolation('gaze_away', `👁 Gaze Away: ${t.gazeDirection} > 2 continuous seconds`);

      // Emit full telemetry to dashboard
      if (onDetectionUpdate) {
        onDetectionUpdate({
          // Face
          faceStatusLabel: t.faceStatusLabel,
          isFaceDetected: t.isFaceDetected,
          faceConfidence: t.faceConfidence,
          faceCountLabel: t.faceCountLabel,
          personCount: t.personCount,
          // Head Pose
          headPoseLabel: t.headPoseLabel,
          headPoseDirection: t.headPoseDirection,
          yawAngle: t.yawAngle,
          pitchAngle: t.pitchAngle,
          rollAngle: t.rollAngle,
          // Eye Gaze
          gazeDirection: t.gazeDirection,
          gazeLabel: t.gazeLabel,
          gazeConfidence: t.gazeConfidence,
          // Objects
          detectedPhone: t.detectedPhone,
          phoneScore: t.phoneScore,
          phoneTrackSec: t.phoneTrackSec,
          detectedEarphones: t.detectedEarphones,
          earphonesScore: t.earphonesScore,
          modelStatus,
        });
      }

      // Stream Real-Time Webcam Frame & Telemetry to Admin Monitor
      if (canvas && video && video.readyState === 4) {
        try {
          const frameImg = canvas.toDataURL('image/jpeg', 0.4);
          let activeUser = null;
          try {
            const stored = localStorage.getItem('user');
            if (stored) activeUser = JSON.parse(stored);
          } catch (e) {}

          if (activeUser && (activeUser.email || activeUser.studentId)) {
            const email = activeUser.email || 'student@university.edu';
            const studentId = activeUser.studentId || `STU_${email.replace(/[^a-z0-9]/g, '_')}`;
            const studentName = activeUser.name || 'Student';

            const socket = getSocket();
            if (socket) {
              socket.emit('video-stream', {
                studentId,
                studentName,
                email,
                image: frameImg,
                timestamp: Date.now()
              });

              socket.emit('telemetry-update', {
                studentId,
                studentName,
                email,
                usn: activeUser.usn || studentId,
                department: activeUser.course || 'Computer Science',
                examName: 'Computer Science Final Assessment',
                status: 'Online',
                faceDetected: !t.faceMissingTrigger,
                multipleFaces: !!t.multiFaceTrigger,
                mobilePhoneDetected: !!t.phoneTrigger,
                headPose: t.headPoseLabel || 'Normal',
                eyeGaze: t.gazeDirection || 'Center',
                image: frameImg
              });
            }
          }
        } catch (e) {}
      }

    }, 300);

    return () => clearInterval(intervalId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProctoringActive, modelStatus]);

  return (
    <div className="athena-webcam-wrapper">
      {/* Live Video */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }}
      />

      {/* Canvas Overlay */}
      <canvas
        ref={canvasRef}
        width={320}
        height={240}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none', transform: 'scaleX(-1)',
        }}
      />

      {/* Live Badge */}
      <div className="athena-webcam-overlay">
        <div className="athena-live-dot" />
        <span>LIVE · {modelStatus}</span>
      </div>
    </div>
  );
}

export default WebcamFeed;
