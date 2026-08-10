import React, { useRef, useState, useCallback } from 'react';
import Webcam from 'react-webcam';
import { getApiBaseUrl } from '../utils/config';


const TARGET_SAMPLES = 30;

const LIVENESS_ACTIONS = [
  { id: 'front', label: '🎯 Front Face (1-6)', prompt: 'Look straight at the camera' },
  { id: 'left', label: '👈 Turn Left (7-12)', prompt: 'Turn head slightly LEFT ◄' },
  { id: 'right', label: '👉 Turn Right (13-18)', prompt: 'Turn head slightly RIGHT ►' },
  { id: 'up', label: '👆 Slight Up (19-24)', prompt: 'Tilt head slightly UP ▲' },
  { id: 'down', label: '👇 Slight Down (25-30)', prompt: 'Tilt head slightly DOWN ▼' },
];

export default function FaceEnrollment({ studentId, name, email, token, onEnrolled, onSkip }) {
  const webcamRef = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | capturing | processing | success | error
  const [actionIdx, setActionIdx] = useState(0);
  const [collectedFrames, setCollectedFrames] = useState([]);
  const [statusMsg, setStatusMsg] = useState('Position your face inside guide oval and click Begin Enrollment');

  const activeEmail = email || localStorage.getItem('registered_email') || 'student@proctor.com';
  const activeName = name || activeEmail.split('@')[0] || 'Student';
  const activeStudentId = studentId || ('STU_' + activeEmail.replace(/[^a-z0-9]/gi, '_'));

  const startEnrollment = useCallback(async () => {
    const video = webcamRef.current?.video;
    if (!video || video.paused || video.ended || video.readyState < 2) {
      setStatusMsg('⚠️ Camera not ready. Ensure camera access is allowed.');
      return;
    }

    setStatus('capturing');
    setStatusMsg('🚀 Capturing 30 InsightFace ArcFace Samples — Follow Pose Prompts!');
    setCollectedFrames([]);

    const frames = [];

    for (let i = 1; i <= TARGET_SAMPLES; i++) {
      if (!webcamRef.current?.video) break;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 320;
        canvas.height = 240;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(webcamRef.current.video, 0, 0, 320, 240);
        const b64 = canvas.toDataURL('image/jpeg', 0.65);
        frames.push(b64);
        setCollectedFrames([...frames]);
      } catch (e) {}

      const poseStep = Math.min(LIVENESS_ACTIONS.length - 1, Math.floor(((i - 1) / TARGET_SAMPLES) * LIVENESS_ACTIONS.length));
      setActionIdx(poseStep);
      const action = LIVENESS_ACTIONS[poseStep];
      setStatusMsg(`📸 Captured ${i}/30 samples — ${action.label}: ${action.prompt}`);

      await new Promise(r => setTimeout(r, 120));
    }

    finishEnrollment(frames);
  }, []);

  const finishEnrollment = async (frames) => {
    if (frames.length < 25) {
      setStatus('error');
      setStatusMsg('❌ Failed: Less than 25 valid face samples captured.');
      return;
    }

    setStatus('processing');
    setStatusMsg('⚙️ Processing InsightFace ArcFace 512-dim L2 Normalization in Backend...');

    try {
      const activeToken = token || localStorage.getItem('token') || 'temp_token';

      const response = await fetch(`${getApiBaseUrl()}/api/face/enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`
        },
        body: JSON.stringify({
          email: activeEmail,
          studentId: activeStudentId,
          name: activeName,
          frames: frames
        })
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setStatus('success');
        setStatusMsg(`✅ InsightFace ArcFace Enrollment Complete! (${data.validSamples || frames.length}/30 samples registered)`);
        setTimeout(() => {
          if (onEnrolled) onEnrolled(data);
        }, 1200);
      } else {
        setStatus('error');
        setStatusMsg(`❌ Enrollment Rejected: ${data.error || 'Quality validation check failed.'}`);
      }
    } catch (err) {
      console.error('ArcFace Enrollment submission error:', err);
      setStatus('error');
      setStatusMsg('❌ Server connection error during ArcFace enrollment.');
    }
  };

  const currentAction = LIVENESS_ACTIONS[actionIdx];

  return (
    <div style={styles.overlay}>
      <div style={styles.card}>
        <div style={styles.header}>
          <span style={{ fontSize: '2rem' }}>🛡️</span>
          <h2 style={styles.title}>ArcFace Biometric Enrollment</h2>
          <p style={styles.subtitle}>Capturing 30 pose samples for InsightFace ArcFace (buffalo_l)</p>
        </div>

        <div style={styles.actionBanner}>
          <div style={{ fontSize: '1.1rem', fontWeight: 800, color: '#38bdf8' }}>
            {currentAction?.label}
          </div>
          <div style={{ fontSize: '0.85rem', color: '#f8fafc', fontWeight: 600, marginTop: '2px' }}>
            {currentAction?.prompt}
          </div>
        </div>

        <div style={styles.webcamWrapper}>
          <Webcam
            ref={webcamRef}
            audio={false}
            width={340}
            height={255}
            screenshotFormat="image/jpeg"
            style={styles.webcam}
            mirrored={true}
          />
          <div style={styles.guideOval} />
        </div>

        {status === 'capturing' && (
          <div style={{ margin: '14px 0 8px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: '#cbd5e1', fontWeight: 600, marginBottom: '4px' }}>
              <span>Collecting Samples</span>
              <span style={{ color: '#34d399' }}>{collectedFrames.length} / {TARGET_SAMPLES} Frames</span>
            </div>
            <div style={styles.progressBar}>
              <div style={{ ...styles.progressFill, width: `${(collectedFrames.length / TARGET_SAMPLES) * 100}%` }} />
            </div>
          </div>
        )}

        <div style={{ ...styles.statusMsg, color: status === 'error' ? '#ef4444' : status === 'success' ? '#10b981' : '#e2e8f0' }}>
          {statusMsg}
        </div>

        <div style={styles.buttonGroup}>
          {status !== 'success' && (
            <button
              onClick={startEnrollment}
              disabled={status === 'capturing' || status === 'processing'}
              style={{
                ...styles.enrollBtn,
                opacity: (status === 'capturing' || status === 'processing') ? 0.6 : 1
              }}
            >
              {status === 'capturing'
                ? `📸 Capturing (${collectedFrames.length}/${TARGET_SAMPLES})...`
                : status === 'processing'
                ? '⚙️ Normalizing ArcFace Embeddings...'
                : '📷 Begin 30-Frame ArcFace Enrollment'}
            </button>
          )}

          {onSkip && status !== 'capturing' && status !== 'processing' && (
            <button onClick={onSkip} style={styles.skipBtn}>
              Skip Enrollment
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const styles = {
  overlay: { position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, backdropFilter: 'blur(12px)' },
  card: { background: 'rgba(15, 23, 42, 0.95)', border: '1px solid rgba(99, 102, 241, 0.4)', borderRadius: '1.5rem', padding: '1.75rem', maxWidth: '460px', width: '92%', textAlign: 'center', boxShadow: '0 25px 50px rgba(0,0,0,0.6)' },
  header: { marginBottom: '1rem' },
  title: { color: '#f8fafc', fontSize: '1.4rem', fontWeight: 700, margin: '0.3rem 0 0.2rem' },
  subtitle: { color: '#94a3b8', fontSize: '0.8rem', margin: 0 },
  actionBanner: { background: 'rgba(99, 102, 241, 0.12)', border: '1px solid rgba(99, 102, 241, 0.35)', borderRadius: '12px', padding: '10px 14px', marginBottom: '1rem' },
  webcamWrapper: { position: 'relative', width: '340px', height: '255px', margin: '0 auto', borderRadius: '1rem', overflow: 'hidden', border: '2px solid #6366f1', background: '#020617' },
  webcam: { width: '100%', height: '100%', objectFit: 'cover' },
  guideOval: { position: 'absolute', top: '15%', left: '22%', width: '56%', height: '70%', border: '2px dashed #34d399', borderRadius: '50%', pointerEvents: 'none' },
  progressBar: { background: '#1e293b', borderRadius: '999px', height: '8px', overflow: 'hidden' },
  progressFill: { height: '100%', background: 'linear-gradient(90deg, #10b981, #6366f1)', borderRadius: '999px', transition: 'width 0.2s ease' },
  statusMsg: { fontSize: '0.85rem', fontWeight: 600, margin: '0.75rem 0', minHeight: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  buttonGroup: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '0.75rem' },
  enrollBtn: { background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: 'white', border: 'none', borderRadius: '12px', padding: '12px', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer' },
  skipBtn: { background: 'none', border: '1px solid #334155', color: '#94a3b8', borderRadius: '10px', padding: '8px', cursor: 'pointer', fontSize: '0.8rem' }
};

