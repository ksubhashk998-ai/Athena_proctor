import React, { useRef, useState, useEffect } from 'react';
import Webcam from 'react-webcam';
import * as faceapi from '@vladmandic/face-api';
import { loadFaceModels, areModelsReady, captureFaceDescriptor } from '../services/faceVerificationService';

export default function FaceVerification({
  userEmail,
  studentId,
  onVerificationSuccess,
  onVerificationFailed,
  onExamTerminated,
  isContinuous = false,
  reverifyIntervalSeconds = 10
}) {
  const webcamRef = useRef(null);
  const [verifying, setVerifying] = useState(false);
  const [statusMsg, setStatusMsg] = useState('Position your face in front of the camera for verification');
  const [isSuccess, setIsSuccess] = useState(false);
  const consecutiveFailuresRef = useRef(0);

  useEffect(() => {
    loadFaceModels();
  }, []);

  // Continuous 10-second re-verification loop during exam
  useEffect(() => {
    if (!isContinuous) return;

    const intervalMs = (reverifyIntervalSeconds || 10) * 1000;
    const interval = setInterval(() => {
      runVerificationPass(true);
    }, intervalMs);

    return () => clearInterval(interval);
  }, [isContinuous, reverifyIntervalSeconds]);

  const runVerificationPass = async (isBackgroundCheck = false) => {
    const video = webcamRef.current?.video;
    if (!video || video.readyState < 2 || !areModelsReady()) return;

    if (!isBackgroundCheck) {
      setVerifying(true);
      setStatusMsg('🔄 Capturing live face & checking MongoDB biometric descriptors...');
    }

    try {
      const descriptor = await captureFaceDescriptor(video);

      if (!descriptor) {
        if (!isBackgroundCheck) {
          setStatusMsg('🔴 Face verification failed: No face detected in camera view');
          if (onVerificationFailed) onVerificationFailed('No face detected');
        } else {
          handleFailurePass('No face detected in frame');
        }
        return;
      }

      // Capture webcam JPEG image frame snapshot for disk saving
      let snapshotBase64 = null;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0);
        snapshotBase64 = canvas.toDataURL('image/jpeg', 0.85);
      } catch (e) {}

      // API call to backend Mongoose verification endpoint
      const emailToVerify = userEmail || localStorage.getItem('registered_email') || 'student@proctor.com';

      const response = await fetch('/api/face/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: emailToVerify,
          studentId,
          descriptor: Array.from(descriptor),
          imageSnapshot: snapshotBase64
        })
      });

      const data = await response.json();

      if (data.match === true) {
        consecutiveFailuresRef.current = 0;
        setIsSuccess(true);
        if (!isBackgroundCheck) {
          setStatusMsg(`✅ ${data.message || 'Face Verified Successfully!'}`);
          if (onVerificationSuccess) onVerificationSuccess(data);
        }
      } else {
        handleFailurePass(data.message || 'Face mismatch detected');
      }
    } catch (err) {
      console.warn('Face verification error:', err);
      if (!isBackgroundCheck) {
        setStatusMsg('🔴 Face verification failed due to network error');
        if (onVerificationFailed) onVerificationFailed('Network error');
      }
    } finally {
      if (!isBackgroundCheck) setVerifying(false);
    }
  };

  const handleFailurePass = async (reason) => {
    consecutiveFailuresRef.current += 1;
    const currentFails = consecutiveFailuresRef.current;
    console.warn(`⚠️ Face Verification Mismatch (${currentFails}/3 consecutive failures): ${reason}`);

    // Capture current frame snapshot for permanent evidence
    const video = webcamRef.current?.video;
    let snapshotBase64 = null;
    if (video && video.readyState === 4) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 480;
        canvas.getContext('2d').drawImage(video, 0, 0);
        snapshotBase64 = canvas.toDataURL('image/jpeg', 0.85);
      } catch (e) {}
    }

    if (currentFails >= 3) {
      setStatusMsg('🚨 EXAM TERMINATED: Face mismatch occurred 3 consecutive times!');

      // Save permanent CheatingLog record in MongoDB
      try {
        await fetch('/api/face/cheating-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: studentId || userEmail || 'STU_CURRENT',
            studentName: localStorage.getItem('registered_name') || 'Student',
            violationType: 'face_mismatch',
            screenshot: snapshotBase64,
            faceImage: snapshotBase64,
            actionTaken: 'Exam Session Terminated (3-Strike Mismatch)',
            terminated: true
          })
        });
      } catch (e) {}

      if (onExamTerminated) {
        onExamTerminated('Face mismatch occurred 3 consecutive times. Exam session terminated for security compliance.');
      }
    } else {
      setStatusMsg(`🔴 Face verification failed: ${reason} (Warning ${currentFails}/3)`);

      // Log intermediate violation to MongoDB
      try {
        fetch('/api/face/cheating-log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId: studentId || userEmail || 'STU_CURRENT',
            studentName: localStorage.getItem('registered_name') || 'Student',
            violationType: 'face_mismatch',
            screenshot: snapshotBase64,
            faceImage: snapshotBase64,
            actionTaken: `Warning ${currentFails}/3`,
            terminated: false
          })
        }).catch(() => {});
      } catch (e) {}

      if (onVerificationFailed) onVerificationFailed(reason);
    }
  };

  return (
    <div style={styles.card}>
      <div style={styles.webcamBox}>
        <Webcam
          ref={webcamRef}
          audio={false}
          width={300}
          height={225}
          screenshotFormat="image/jpeg"
          style={styles.webcam}
          mirrored={true}
        />
      </div>

      <div style={{ ...styles.statusBanner, color: isSuccess ? '#10b981' : '#f87171' }}>
        {statusMsg}
      </div>

      {!isContinuous && (
        <button
          onClick={() => runVerificationPass(false)}
          disabled={verifying}
          style={{ ...styles.verifyBtn, opacity: verifying ? 0.6 : 1 }}
        >
          {verifying ? '🔄 Verifying Live Face...' : '📸 Verify Face & Start Exam'}
        </button>
      )}
    </div>
  );
}

const styles = {
  card: { background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.4)', borderRadius: '1rem', padding: '1.25rem', textAlign: 'center' },
  webcamBox: { width: '300px', height: '225px', margin: '0 auto', borderRadius: '12px', overflow: 'hidden', border: '2px solid #6366f1' },
  webcam: { width: '100%', height: '100%', objectFit: 'cover' },
  statusBanner: { fontSize: '0.85rem', fontWeight: 700, margin: '12px 0' },
  verifyBtn: { background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: 'white', border: 'none', borderRadius: '10px', padding: '10px 20px', fontWeight: 700, cursor: 'pointer' }
};
