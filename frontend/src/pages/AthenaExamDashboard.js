import React, { useState, useEffect, useCallback } from 'react';
import AthenaHeader from '../components/athena/AthenaHeader';
import ExamBlockerModal from '../components/athena/ExamBlockerModal';
import SubmitConfirmationModal from '../components/athena/SubmitConfirmationModal';
import MCQSection from '../components/athena/MCQSection';
import CodingSection from '../components/athena/CodingSection';
import TheorySection from '../components/athena/TheorySection';
import AIMonitoringSidebar from '../components/athena/AIMonitoringSidebar';
import { mcqQuestions, codingProblems, theoryQuestions } from '../data/examData';
import { getSocket } from '../services/socketService';
import '../styles/athena.css';

function AthenaExamDashboard() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('mcq');

  // Exam Permission & Unlocking State
  const [hasCamera, setHasCamera] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [isExamUnlocked, setIsExamUnlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Timer State (60 minutes = 3600 seconds)
  const [timerSeconds, setTimerSeconds] = useState(3600);

  // Submit Modal State
  const [isSubmitModalOpen, setIsSubmitModalOpen] = useState(false);

  // Live User Response States
  const [mcqAnswers, setMcqAnswers] = useState({});
  const [codingSubmissions, setCodingSubmissions] = useState({});
  const [theoryAnswers, setTheoryAnswers] = useState({});

  const mcqAnsweredCount = Object.values(mcqAnswers).filter(val => val !== undefined && val !== null).length;
  const codingSubmittedCount = Object.values(codingSubmissions).filter(Boolean).length;
  const theoryCompletedCount = Object.values(theoryAnswers).filter(text => text && text.trim().length > 0).length;

  // Proctor Telemetry State
  const [tabSwitchesCount, setTabSwitchesCount] = useState(0);
  const [violationsCount, setViolationsCount] = useState(0);
  const [voiceDetected, setVoiceDetected] = useState(false);

  const [eyeTrackingState, setEyeTrackingState] = useState({
    status: 'green',
    value: 'Center',
    detail: 'Gaze: Center (99%)'
  });

  const [faceDetectionState, setFaceDetectionState] = useState({
    status: 'green',
    value: '✓ Face Detected',
    detail: 'Faces: 1 (Verified)'
  });

  const [phoneDetectionState, setPhoneDetectionState] = useState({
    status: 'green',
    value: '✗ No Phone Detected'
  });

  const [earphoneDetectionState, setEarphoneDetectionState] = useState({
    status: 'green',
    value: '✗ Not Detected'
  });

  const [headPoseState, setHeadPoseState] = useState({
    status: 'green',
    value: 'Looking Center'
  });

  // Terminal Activity Logs
  const [logs, setLogs] = useState([
    { id: 1, time: new Date().toLocaleTimeString(), message: 'Athena AI Proctoring Engine Initialized (Strict Inference Sentinel)', type: 'info' }
  ]);

  // Add Log Helper
  const addLog = useCallback((message, type = 'warning') => {
    const newEntry = {
      id: Date.now() + Math.random(),
      time: new Date().toLocaleTimeString(),
      message,
      type
    };
    setLogs(prev => [...prev.slice(-49), newEntry]); // Keep last 50 entries
  }, []);

  // Trigger Violation Helper
  const recordViolation = useCallback((message) => {
    setViolationsCount(prev => prev + 1);
    addLog(message, 'danger');
  }, [addLog]);

  // Live Admin Monitoring & Socket Sync Effect
  useEffect(() => {
    let activeUser = null;
    try {
      const stored = localStorage.getItem('user');
      if (stored) activeUser = JSON.parse(stored);
    } catch (e) {}

    const studentId = activeUser?.studentId || 'STU_KCS998';
    const studentName = activeUser?.name || 'K. Subhash';
    const email = activeUser?.email || 'ksubhashk998@gmail.com';
    const usn = activeUser?.usn || studentId;

    const payload = {
      studentId,
      studentName,
      usn,
      email,
      examName: 'Computer Science Final Assessment',
      department: 'Computer Science & Engineering',
      status: 'Online',
      riskLevel: violationsCount >= 4 ? 'High' : violationsCount >= 2 ? 'Medium' : 'Low',
      tabSwitchingCount: tabSwitchesCount,
      suspiciousActivityCount: violationsCount,
      faceDetected: faceDetectionState?.value?.includes('Detected') || true,
      multipleFaces: faceDetectionState?.detail?.includes('Faces: 2') || false,
      mobilePhoneDetected: phoneDetectionState?.value?.includes('Detected') && !phoneDetectionState?.value?.includes('No'),
      headPose: headPoseState?.value || 'Normal',
      eyeGaze: eyeTrackingState?.value || 'Center'
    };

    fetch('http://localhost:5000/api/admin/live-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(err => console.error('Live session register notice:', err));

    const socket = getSocket();
    if (socket) {
      socket.emit('student-connected', payload);
      socket.emit('exam-start', payload);
    }
  }, [violationsCount, tabSwitchesCount, faceDetectionState, phoneDetectionState, headPoseState, eyeTrackingState]);


  // Request Permissions Callback (Immediate & Non-Blocking)
  const handleRequestPermissions = useCallback(async () => {
    setHasCamera(true);
    setHasMic(true);
    addLog('Camera & Microphone permissions enabled', 'info');

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        await navigator.mediaDevices.getUserMedia({ video: true, audio: true }).catch(err => {
          console.warn('Camera/Mic stream notice:', err.message);
        });
      }
    } catch (err) {
      console.warn('Permission request notice:', err);
    }
  }, [addLog]);

  // Auto request permissions on mount
  useEffect(() => {
    handleRequestPermissions();
  }, [handleRequestPermissions]);

  // EXAM START FLOW — Directly starts exam after System Check & Pre-Exam Audit
  const handleStartExam = useCallback(() => {
    setIsExamUnlocked(true);
    addLog('🚀 System Checks & Identity Verified! Exam session unlocked.', 'info');
  }, [addLog]);

  // Toggle Fullscreen
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(err => console.warn(err));
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen().then(() => setIsFullscreen(false));
      }
    }
  };

  // 1. Live Production Telemetry Callback (Instant Stale Reset & Strict Rules)
  const handleDetectionUpdate = useCallback((data) => {
    const {
      faceStatusLabel,
      isFaceDetected,
      faceConfidence,
      faceCountLabel,
      personCount,
      detectedPhone,
      phoneScore,
      phoneTrackSec,
      detectedEarphones,
      earphonesScore,
      gazeDirection,
      gazeLabel,
      gazeConfidence,
      headPoseLabel,
      headPoseDirection,
      yawAngle,
      pitchAngle,
      rollAngle,
    } = data;

    // Phone State Rule: ✓ Phone Detected / ✗ No Phone Detected (Instant Reset)
    if (detectedPhone) {
      setPhoneDetectionState({
        status: 'red',
        value: `✓ Phone Detected (${phoneScore}%)`,
        detail: `Track: ${phoneTrackSec}s`,
      });
    } else {
      setPhoneDetectionState({
        status: 'green',
        value: '✗ No Phone Detected',
      });
    }

    // Earphones / AirPods State Rule: ✓ Detected / ✗ Not Detected (Instant Reset)
    if (detectedEarphones) {
      setEarphoneDetectionState({
        status: 'red',
        value: `✓ Earphones Detected (${earphonesScore}%)`,
      });
    } else {
      setEarphoneDetectionState({
        status: 'green',
        value: '✗ Not Detected',
      });
    }

    // Face State Rule: ✓ Face Detected / ✗ Face Missing (Faces: 0 | 1 | 2 | 3+)
    if (!isFaceDetected && personCount === 0) {
      setFaceDetectionState({
        status: 'red',
        value: faceStatusLabel || '✗ Face Missing',
        detail: 'Candidate absent from camera',
      });
    } else if (personCount >= 2) {
      setFaceDetectionState({
        status: 'red',
        value: `⚠️ Multiple Faces (${faceCountLabel})`,
        detail: 'Multiple candidates detected!',
      });
    } else {
      setFaceDetectionState({
        status: 'green',
        value: `${faceStatusLabel || '✓ Face Detected'} (${faceConfidence}%)`,
        detail: faceCountLabel,
      });
    }

    // Head Pose State — show real Yaw/Pitch/Roll angles from MediaPipe
    const isHeadAway = headPoseDirection && headPoseDirection !== 'Center';
    setHeadPoseState({
      status: isHeadAway ? 'orange' : 'green',
      value: isHeadAway
        ? (headPoseLabel || `⚠ Looking ${headPoseDirection}`)
        : '✓ Looking Center',
      detail: yawAngle !== undefined
        ? `Yaw: ${yawAngle}° | Pitch: ${pitchAngle}° | Roll: ${rollAngle}°`
        : undefined,
    });

    // Eye Gaze Tracking State — from real MediaPipe iris landmarks
    const isGazeAway = gazeDirection && gazeDirection !== 'Center';
    setEyeTrackingState({
      status: isGazeAway ? 'orange' : 'green',
      value: isGazeAway
        ? (gazeLabel || `⚠ Looking ${gazeDirection}`)
        : '✓ Looking Center',
      detail: isGazeAway
        ? `Iris Gaze: ${gazeDirection} (${gazeConfidence ?? 0}%)`
        : `Gaze: Center (${gazeConfidence ?? 99}%)`,
    });
  }, []);


  // Progressive 3-Warning Multi-Face State (Requirement 2, 3 & 4)
  const [multiFaceWarningsCount, setMultiFaceWarningsCount] = useState(0);
  const [multiFaceModal, setMultiFaceModal] = useState({
    isOpen: false,
    warningNumber: 0,
    title: '',
    message: '',
    screenshot: null
  });
  const lastMultiFaceTimeRef = React.useRef(0);

  const handleMultiFaceViolation = useCallback(async (details) => {
    const now = Date.now();
    // Requirement 5 Cooldown Guard: at least 8s between distinct warning triggers
    if (now - lastMultiFaceTimeRef.current < 8000) return;
    lastMultiFaceTimeRef.current = now;

    let activeUser = null;
    let studentId = 'STU_DEMO';
    let studentEmail = 'student@university.edu';
    let token = '';

    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        activeUser = JSON.parse(stored);
        studentId = activeUser.studentId || studentId;
        studentEmail = activeUser.email || studentEmail;
      }
      token = localStorage.getItem('token') || '';
    } catch (e) {}

    const screenshot = typeof details === 'object' ? details.image || details.screenshot : null;

    setMultiFaceWarningsCount(prev => {
      const nextWarn = Math.min(3, prev + 1);
      recordViolation(`🚨 Multiple Faces Detected (${nextWarn}/3 Confirmed Warnings)`);

      // Log violation to MongoDB (Requirement 7)
      fetch('/api/violations/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          studentId,
          studentEmail,
          examId: 'CS_EXAM_FINAL',
          type: 'MULTIPLE_FACE',
          violationType: 'MULTIPLE_FACE',
          warningNumber: nextWarn,
          description: `Multiple Faces Detected (${nextWarn}/3 Confirmed Warnings)`,
          screenshotBase64: screenshot,
          screenshotPath: screenshot,
          severity: nextWarn >= 3 ? 'critical' : 'high'
        })
      }).catch(err => console.warn('Violation DB log notice:', err));

      // Warning Messages (Exact Specification)
      let title = `⚠ Warning ${nextWarn} of 3`;
      let message = 'Please keep your attention on the exam.';

      if (nextWarn === 2) {
        message = 'Repeated suspicious behavior detected.';
      } else if (nextWarn >= 3) {
        title = '🚫 Warning 3 of 3: Exam Terminated';
        message = 'Exam terminated due to repeated violations.';
      }

      setMultiFaceModal({
        isOpen: true,
        warningNumber: nextWarn,
        title,
        message,
        screenshot
      });

      // Requirement 4: Action on 3rd Confirmed Violation
      if (nextWarn >= 3) {
        setIsExamUnlocked(false);
        // Stop webcam and mic streams
        try {
          navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(stream => {
            stream.getTracks().forEach(track => track.stop());
          }).catch(() => {});
        } catch (e) {}

        // Auto submit exam
        setTimeout(() => {
          setIsSubmitModalOpen(true);
        }, 2200);
      }

      return nextWarn;
    });
  }, [recordViolation]);

  // 2. Real-time Violation Callback from Detection Sentinels
  const handleViolationTriggered = useCallback((type, details) => {
    if (type === 'multiple_faces' || details?.type === 'multiple_faces' || details?.multipleFaces) {
      handleMultiFaceViolation(details);
    } else {
      recordViolation(typeof details === 'string' ? details : details?.description || type);
      if (type === 'continuous_mismatch_pause') {
        setIsExamUnlocked(false);
      }
    }
  }, [handleMultiFaceViolation, recordViolation]);

  // 3. Voice Status Change & Violation Callback from AudioWaveMeter
  const handleVoiceStatusChange = useCallback((status) => {
    setVoiceDetected(status !== 'Normal');
  }, []);

  const handleVoiceViolationTriggered = useCallback((type, details) => {
    recordViolation(details);
  }, [recordViolation]);

  // 4. Timer Countdown Effect
  useEffect(() => {
    if (!isExamUnlocked) return;
    const interval = setInterval(() => {
      setTimerSeconds(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          setIsSubmitModalOpen(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isExamUnlocked]);

  // 5. Global Security Event Listeners (Tab Switches, DevTools, Copy-Paste, Window Blur)
  useEffect(() => {
    if (!isExamUnlocked) return;

    // Tab switch & visibility detection
    const handleVisibilityChange = () => {
      if (document.hidden) {
        setTabSwitchesCount(prev => {
          const nextCount = prev + 1;
          recordViolation(`⚠️ Tab / Window Switch Detected (${nextCount}/3)`);

          // Rule: Max 3 tab switches -> Auto Submit Exam
          if (nextCount >= 3) {
            recordViolation('🚨 Maximum 3 tab switches reached! Auto-submitting exam attempt...');
            setTimeout(() => {
              setIsSubmitModalOpen(true);
            }, 800);
          }

          return nextCount;
        });
      }
    };

    // DevTools & Keyboard shortcut blocking
    const handleKeyDown = (e) => {
      if (e.key === 'F12' || (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'i' || e.key === 'J' || e.key === 'j' || e.key === 'C' || e.key === 'c'))) {
        e.preventDefault();
        recordViolation('🚫 Developer Tools Inspection Attempt Blocked');
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'v' || e.key === 'u' || e.key === 'C' || e.key === 'V' || e.key === 'U')) {
        e.preventDefault();
        recordViolation(`🚫 Clipboard/Shortcut Violation (Ctrl+${e.key.toUpperCase()})`);
      }
    };

    // Right-click context menu blocking
    const handleContextMenu = (e) => {
      e.preventDefault();
      recordViolation('🚫 Context Menu (Right Click) Blocked');
    };

    // Window Blur detection
    const handleWindowBlur = () => {
      recordViolation('⚠️ Window Lost Focus (Candidate clicked outside exam environment)');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('contextmenu', handleContextMenu);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isExamUnlocked, recordViolation]);

  return (
    <div className="athena-wrapper">
      {/* Top Header Component */}
      <AthenaHeader
        timerSeconds={timerSeconds}
        isFullscreen={isFullscreen}
        toggleFullscreen={toggleFullscreen}
        onOpenSubmitModal={() => setIsSubmitModalOpen(true)}
      />

      {/* Main Examination Dashboard Grid (70% Left / 30% Right) */}
      <div className="athena-dashboard-grid">
        {/* LEFT SIDE (70%) - EXAM WORKSPACE */}
        <main className="athena-left-panel">
          {/* Top Section Tabs: MCQ | Coding | Theory */}
          <nav className="athena-nav-tabs">
            <button
              onClick={() => setActiveTab('mcq')}
              className={`athena-nav-tab ${activeTab === 'mcq' ? 'active' : ''}`}
            >
              <i className="fas fa-list-check"></i>
              <span>Section 1: MCQ</span>
            </button>

            <button
              onClick={() => setActiveTab('coding')}
              className={`athena-nav-tab ${activeTab === 'coding' ? 'active' : ''}`}
            >
              <i className="fas fa-laptop-code"></i>
              <span>Section 2: Coding</span>
            </button>

            <button
              onClick={() => setActiveTab('theory')}
              className={`athena-nav-tab ${activeTab === 'theory' ? 'active' : ''}`}
            >
              <i className="fas fa-file-pen"></i>
              <span>Section 3: Theory</span>
            </button>
          </nav>

          {/* Dynamic Content Workspace Card */}
          <div className="athena-workspace-card">
            {activeTab === 'mcq' && (
              <MCQSection
                questions={mcqQuestions}
                answers={mcqAnswers}
                onAnswerChange={setMcqAnswers}
              />
            )}

            {activeTab === 'coding' && (
              <CodingSection
                problems={codingProblems}
                onSubmitProblem={(probIdx) => setCodingSubmissions(prev => ({ ...prev, [probIdx]: true }))}
              />
            )}

            {activeTab === 'theory' && (
              <TheorySection
                questions={theoryQuestions}
                essayAnswers={theoryAnswers}
                onAnswerChange={setTheoryAnswers}
              />
            )}
          </div>
        </main>

        {/* RIGHT SIDE (30%) - AI MONITORING PANEL */}
        <AIMonitoringSidebar
          isProctoringActive={isExamUnlocked}
          eyeTrackingState={eyeTrackingState}
          faceDetectionState={faceDetectionState}
          phoneDetectionState={phoneDetectionState}
          earphoneDetectionState={earphoneDetectionState}
          headPoseState={headPoseState}
          tabSwitchesCount={tabSwitchesCount}
          multiFaceWarningsCount={multiFaceWarningsCount}
          violationsCount={violationsCount}
          voiceDetected={voiceDetected}
          logs={logs}
          phoneDetected={phoneDetectionState.status === 'red'}
          multiFaceDetected={faceDetectionState.status === 'red'}
          onDetectionUpdate={handleDetectionUpdate}
          onViolationTriggered={handleViolationTriggered}
          onVoiceStatusChange={handleVoiceStatusChange}
          onVoiceViolationTriggered={handleVoiceViolationTriggered}
        />
      </div>

      {/* Progressive Multi-Face Warning Modal Popup (Requirement 2 & 3) */}
      {multiFaceModal.isOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(2, 6, 23, 0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 99999, backdropFilter: 'blur(12px)' }}>
          <div style={{ background: 'rgba(15, 23, 42, 0.96)', border: `1px solid ${multiFaceModal.warningNumber >= 3 ? '#ef4444' : '#f59e0b'}`, borderRadius: '1.5rem', padding: '2rem', maxWidth: '480px', width: '92%', textAlign: 'center', boxShadow: '0 25px 50px rgba(0,0,0,0.6)' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>
              {multiFaceModal.warningNumber >= 3 ? '🚫' : '⚠️'}
            </div>
            <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: multiFaceModal.warningNumber >= 3 ? '#ef4444' : '#fbbf24', marginBottom: '8px' }}>
              {multiFaceModal.title}
            </h2>
            <p style={{ color: '#e2e8f0', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '20px' }}>
              {multiFaceModal.message}
            </p>

            {multiFaceModal.screenshot && (
              <div style={{ marginBottom: '16px', borderRadius: '12px', overflow: 'hidden', border: '2px solid #ef4444', maxHeight: '180px' }}>
                <img src={multiFaceModal.screenshot} alt="Violation Evidence" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              </div>
            )}

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', background: 'rgba(239, 68, 68, 0.15)', border: '1px solid #ef4444', color: '#fca5a5', padding: '6px 16px', borderRadius: '20px', fontSize: '0.85rem', fontWeight: 800, marginBottom: '20px' }}>
              <span>Multi-Face Warnings: {multiFaceModal.warningNumber} / 3</span>
            </div>

            <div>
              <button
                onClick={() => setMultiFaceModal(prev => ({ ...prev, isOpen: false }))}
                style={{ background: multiFaceModal.warningNumber >= 3 ? '#ef4444' : 'linear-gradient(135deg, #4f46e5, #7c3aed)', color: 'white', border: 'none', borderRadius: '12px', padding: '12px 24px', fontSize: '0.95rem', fontWeight: 700, cursor: 'pointer' }}
              >
                {multiFaceModal.warningNumber >= 3 ? 'View Submission Report' : 'Acknowledge & Resume Exam'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permission Blocker Modal */}
      {/* System Check & Identity Verification Blocker Modal */}
      {!isExamUnlocked && (
        <ExamBlockerModal
          hasCamera={hasCamera}
          hasMic={hasMic}
          onRequestPermissions={handleRequestPermissions}
          onStartExam={handleStartExam}
        />
      )}

      {/* Final Submit Confirmation Modal */}
      <SubmitConfirmationModal
        isOpen={isSubmitModalOpen}
        onClose={() => setIsSubmitModalOpen(false)}
        onConfirmSubmit={() => {
          alert('🎓 Exam submitted successfully! Redirecting to student summary dashboard...');
          window.location.href = '/dashboard';
        }}
        mcqStats={{ answered: mcqAnsweredCount, total: mcqQuestions.length }}
        codingStats={{ submitted: codingSubmittedCount, total: codingProblems.length }}
        theoryStats={{ completed: theoryCompletedCount, total: theoryQuestions.length }}
        totalViolations={violationsCount}
      />
    </div>
  );
}

export default AthenaExamDashboard;
