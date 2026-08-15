import React, { useEffect, useRef, useState } from 'react';
import proctoringPipeline from '../../services/proctoringPipeline';
import { getSocket } from '../../services/socketService';

function WebcamFeed({ isProctoringActive, onDetectionUpdate, onViolationTriggered, identityVerification }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const [modelStatus, setModelStatus] = useState('Initializing MediaPipe Face Mesh...');
  const lastViolationTimes = useRef({});
  const [fps, setFps] = useState(30);
  const lastFrameTimeRef = useRef(Date.now());
  const [personCount, setPersonCount] = useState(1);
  const [faceConfidence, setFaceConfidence] = useState(98);
  const [isFaceCentered, setIsFaceCentered] = useState(true);
  const [faceGuideMsg, setFaceGuideMsg] = useState('✓ Face Centered');

  // Active student profile from MongoDB / Auth
  const activeStudent = (() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return null;
  })();

  const studentName = (() => {
    if (identityVerification?.studentName) return identityVerification.studentName;
    if (activeStudent?.firstName && activeStudent?.lastName) {
      return `${activeStudent.firstName} ${activeStudent.lastName}`;
    }
    return activeStudent?.fullName || activeStudent?.name || 'Subhash K';
  })();

  const isVerified = identityVerification?.isVerified !== false;
  const confidence = identityVerification?.confidence || faceConfidence || 98;

  // ── 1. Initialize Webcam Stream ─────────────────────────────
  useEffect(() => {
    let stream = null;

    async function startCamera() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
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

      // Compute live FPS
      const now = Date.now();
      const delta = now - lastFrameTimeRef.current;
      lastFrameTimeRef.current = now;
      if (delta > 0) {
        const calculatedFps = Math.round(1000 / delta);
        setFps(Math.min(60, Math.max(15, calculatedFps)));
      }

      const studentInfo = {
        studentName,
        isVerified,
        confidence,
        identityStatus: isVerified ? 'Verified' : 'Identity Failed'
      };

      const t = await proctoringPipeline.processFrame(video, canvas, studentInfo);

      if (t) {
        setPersonCount(t.personCount || 0);
        if (t.faceConfidence) setFaceConfidence(t.faceConfidence);
        setIsFaceCentered(t.isFaceCentered || false);
        setFaceGuideMsg(t.faceGuideMessage || (t.isFaceCentered ? '✓ Face Centered' : 'Center Your Face'));
      }

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
          faceStatusLabel: t.faceStatusLabel,
          isFaceDetected: t.isFaceDetected,
          faceConfidence: t.faceConfidence,
          faceCountLabel: t.faceCountLabel,
          personCount: t.personCount,
          headPoseLabel: t.headPoseLabel,
          headPoseDirection: t.headPoseDirection,
          yawAngle: t.yawAngle,
          pitchAngle: t.pitchAngle,
          rollAngle: t.rollAngle,
          gazeDirection: t.gazeDirection,
          gazeLabel: t.gazeLabel,
          gazeConfidence: t.gazeConfidence,
          detectedPhone: t.detectedPhone,
          phoneScore: t.phoneScore,
          phoneTrackSec: t.phoneTrackSec,
          detectedEarphones: t.detectedEarphones,
          earphonesScore: t.earphonesScore,
          modelStatus,
        });
      }

      // Stream Real-Time High-Definition Webcam Frame & Telemetry to Admin Monitor via Socket.IO
      if (canvas && video && video.readyState === 4) {
        try {
          if (canvas.width !== (video.videoWidth || 640) && video.videoWidth > 0) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          const frameImg = canvas.toDataURL('image/jpeg', 0.85);
          const email = activeStudent?.email || 'student@university.edu';
          const studentId = activeStudent?.studentId || `STU_${email.replace(/[^a-z0-9]/g, '_')}`;

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
              studentName: isVerified ? studentName : 'Unknown Person Detected',
              email,
              usn: activeStudent?.usn || studentId,
              department: activeStudent?.course || 'Computer Science',
              examName: 'Computer Science Final Assessment',
              status: isVerified ? 'Online' : 'Identity Failed',
              identityStatus: isVerified ? 'Verified' : 'Identity Failed',
              confidence,
              faceDetected: !t.faceMissingTrigger,
              multipleFaces: !!t.multiFaceTrigger,
              mobilePhoneDetected: !!t.phoneTrigger,
              headPose: t.headPoseLabel || 'Normal',
              eyeGaze: t.gazeDirection || 'Center',
              image: frameImg
            });
          }
        } catch (e) {}
      }

    }, 300);

    return () => clearInterval(intervalId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProctoringActive, modelStatus, studentName, isVerified, confidence]);

  // Helper Functions for Overlay Colors and Text
  const getOverlayBadge = () => {
    if (personCount === 0) {
      return {
        header: '⚠️ No Face Detected',
        subtext: 'Searching for candidate...',
        borderColor: '#f59e0b',
        textColor: '#fbbf24'
      };
    }
    if (personCount > 1) {
      return {
        header: '🚨 Multiple Faces Detected',
        subtext: `${personCount} Persons Visible`,
        borderColor: '#ef4444',
        textColor: '#f87171'
      };
    }
    if (!isVerified) {
      return {
        header: '🔴 Unknown Person',
        subtext: `Mismatch (${confidence}%)`,
        borderColor: '#ef4444',
        textColor: '#f87171'
      };
    }
    return {
      header: `👤 ${studentName}`,
      subtext: `✔ Verified (${confidence}%)`,
      borderColor: '#10b981',
      textColor: '#34d399'
    };
  };

  const badge = getOverlayBadge();

  return (
    <div style={{
      position: 'relative',
      width: '100%',
      height: '240px',
      borderRadius: '16px',
      overflow: 'hidden',
      border: `1.5px solid ${badge.borderColor}`,
      background: '#020617',
      boxShadow: '0 10px 25px rgba(0,0,0,0.5)'
    }}>
      {/* Live Unmirrored Video Feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          display: 'block'
        }}
      />

      {/* Unmirrored Canvas Overlay for Face Bounding Boxes & Reticles */}
      <canvas
        ref={canvasRef}
        width={320}
        height={240}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none'
        }}
      />

      {/* Fix 6: Green Face Guide Overlay */}
      <div className="face-guide" style={{
        position: 'absolute',
        width: '130px',
        height: '160px',
        border: `2.5px dashed ${isFaceCentered ? '#00ff66' : '#f59e0b'}`,
        borderRadius: '50%',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 15,
        boxShadow: isFaceCentered ? '0 0 14px rgba(0, 255, 102, 0.45)' : 'none',
        transition: 'all 0.2s ease'
      }} />

      {/* Face Centering Status Indicator */}
      <div style={{
        position: 'absolute',
        bottom: '36px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        background: isFaceCentered ? 'rgba(0, 255, 102, 0.18)' : 'rgba(245, 158, 11, 0.18)',
        border: `1px solid ${isFaceCentered ? '#00ff66' : '#f59e0b'}`,
        borderRadius: '12px',
        padding: '2px 10px',
        fontSize: '0.72rem',
        fontWeight: 800,
        color: isFaceCentered ? '#00ff66' : '#fbbf24',
        boxShadow: '0 4px 10px rgba(0,0,0,0.5)'
      }}>
        {faceGuideMsg}
      </div>

      {/* TOP LEFT: LIVE Indicator */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '10px',
        zIndex: 20,
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(16, 185, 129, 0.4)',
        borderRadius: '20px',
        padding: '4px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '0.75rem',
        fontWeight: 800,
        color: '#34d399'
      }}>
        <span style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: '#10b981',
          boxShadow: '0 0 8px #10b981',
          animation: 'pulse 1.5s infinite'
        }}></span>
        <span>🟢 LIVE</span>
      </div>

      {/* MIDDLE TOP: Student Name & Verification Badge */}
      <div style={{
        position: 'absolute',
        top: '10px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 20,
        textAlign: 'center',
        width: 'max-content'
      }}>
        <div style={{
          background: 'rgba(15, 23, 42, 0.92)',
          backdropFilter: 'blur(12px)',
          border: `1.5px solid ${badge.borderColor}`,
          borderRadius: '12px',
          padding: '5px 14px',
          boxShadow: '0 8px 20px rgba(0,0,0,0.6)'
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 800, color: badge.textColor }}>
            {badge.header}
          </div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#cbd5e1', marginTop: '1px' }}>
            {badge.subtext}
          </div>
        </div>
      </div>

      {/* BOTTOM LEFT: FPS Counter */}
      <div style={{
        position: 'absolute',
        bottom: '10px',
        left: '10px',
        zIndex: 20,
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '8px',
        padding: '3px 8px',
        fontSize: '0.7rem',
        fontWeight: 700,
        color: '#94a3b8'
      }}>
        ⚡ {fps} FPS
      </div>

      {/* BOTTOM RIGHT: Face Match Confidence */}
      <div style={{
        position: 'absolute',
        bottom: '10px',
        right: '10px',
        zIndex: 20,
        background: 'rgba(15, 23, 42, 0.85)',
        backdropFilter: 'blur(8px)',
        border: '1px solid rgba(96, 165, 250, 0.4)',
        borderRadius: '8px',
        padding: '3px 8px',
        fontSize: '0.7rem',
        fontWeight: 700,
        color: '#60a5fa'
      }}>
        🎯 Confidence: {confidence}%
      </div>
    </div>
  );
}

export default WebcamFeed;
