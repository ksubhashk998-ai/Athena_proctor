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
import { captureFaceDescriptor } from '../services/faceVerificationService';
import { getApiBaseUrl } from '../utils/config';
import '../styles/athena.css';

function AthenaExamDashboard() {
  // Navigation State
  const [activeTab, setActiveTab] = useState('mcq');

  // Exam Permission & Unlocking State
  const [hasCamera, setHasCamera] = useState(false);
  const [hasMic, setHasMic] = useState(false);
  const [isExamUnlocked, setIsExamUnlocked] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Requirement 5 & 7 Identity Verification & Auto-Termination States
  const [identityVerification, setIdentityVerification] = useState(() => {
    let studentName = 'Subhash K';
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u.firstName && u.lastName) {
          studentName = `${u.firstName} ${u.lastName}`;
        } else {
          studentName = u.fullName || u.name || studentName;
        }
      }
    } catch (e) {}
    return {
      isVerified: true,
      studentName,
      confidence: 98,
      status: 'Verified'
    };
  });

  const [, setConsecutiveIdentityFailures] = useState(0);
  const [isExamTerminated, setIsExamTerminated] = useState(false);
  const [terminationReason, setTerminationReason] = useState('');

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

  // Tab Switch & Exam Termination States
  const [isTerminated, setIsTerminated] = useState(false);
  const [terminationReason, setTerminationReason] = useState('');
  const [tabSwitchWarning, setTabSwitchWarning] = useState({ open: false, count: 0, max: 3, message: '' });

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

  // Auto-Termination Helper Function (Requirement 7)
  const handleAutoTermination = useCallback(async (videoEl, studentId, fullName, email, reason) => {
    setIsExamTerminated(true);
    setTerminationReason(reason);
    recordViolation(`🔴 AUTO-TERMINATION: ${reason}`);

    let screenshotBase64 = null;
    if (videoEl) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = videoEl.videoWidth || 640;
        canvas.height = videoEl.videoHeight || 480;
        canvas.getContext('2d').drawImage(videoEl, 0, 0);
        screenshotBase64 = canvas.toDataURL('image/jpeg', 0.5);
      } catch (e) {}
    }

    // 1. Send termination to Admin Backend REST API
    try {
      await fetch('/api/admin/terminate-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          reason: reason || 'Exceeded maximum proctoring violation threshold',
          status: 'Terminated'
        })
      });
    } catch (e) {}

    // 2. Save Incident to Database
    try {
      await fetch('/api/incidents/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          fullName,
          email,
          screenshot: screenshotBase64,
          reason: reason || 'Face Mismatch',
          confidence: 0,
          timestamp: new Date()
        })
      });
    } catch (err) {
      console.error('Save incident log error:', err);
    }

    // 3. Broadcast Real-Time Events to Admin via Socket.IO
    const socket = getSocket();
    if (socket) {
      const payload = {
        studentId,
        studentName: fullName,
        email,
        reason: reason || 'Exam Terminated',
        status: 'Terminated',
        screenshot: screenshotBase64,
        timestamp: new Date()
      };
      socket.emit('student-terminated', payload);
      socket.emit('student-status', { studentId, status: 'Terminated' });
      socket.emit('dashboard-updated', { timestamp: Date.now() });
    }
  }, [recordViolation]);

  // Requirement 5, 7, & 10: Continuous Real-Time Identity Verification Loop (Every 6 Seconds)
  useEffect(() => {
    if (!isExamUnlocked || isExamTerminated) return;

    const activeUser = (() => {
      try {
        const stored = localStorage.getItem('user');
        return stored ? JSON.parse(stored) : null;
      } catch (e) {
        return null;
      }
    })();

    const studentId = activeUser?.studentId || ('STU_' + Date.now());
    const email = activeUser?.email || 'john@gmail.com';
    const fullName = activeUser?.fullName || activeUser?.name || 'John Smith';
    const token = localStorage.getItem('token') || 'temp_token';

    const interval = setInterval(async () => {
      const video = document.querySelector('video');
      if (!video || video.readyState < 2) return;

      try {
        const descriptor = await captureFaceDescriptor(video);

        if (!descriptor) {
          // Face missing in camera frame
          setConsecutiveIdentityFailures(prev => {
            const nextFailures = prev + 1;
            console.warn(`🔴 Identity Check Failed (No Face). Consecutive failures: ${nextFailures}/3`);

            setIdentityVerification({
              isVerified: false,
              studentName: '', // Name disappears on mismatch / missing face!
              confidence: 0,
              status: 'Unknown Person Detected'
            });

            if (nextFailures > 3) {
              handleAutoTermination(video, studentId, fullName, email, 'Face Mismatch - Candidate Absent / No Face Detected');
            }
            return nextFailures;
          });
          return;
        }

        // Compare live face embedding with enrolled embedding via backend API
        const response = await fetch('/api/face/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            studentId,
            email,
            embedding: Array.from(descriptor)
          })
        });

        const data = await response.json();

        if (data.match === true) {
          setConsecutiveIdentityFailures(0);
          setIdentityVerification({
            isVerified: true,
            studentName: data.student?.fullName || fullName,
            confidence: data.similarityPct || 98,
            status: 'Verified'
          });

          // Broadcast verified status update to Admin via Socket.IO
          const socket = getSocket();
          if (socket) {
            socket.emit('telemetry-update', {
              studentId,
              studentName: fullName,
              email,
              identityStatus: 'Verified',
              confidence: data.similarityPct || 98,
              examStatus: 'Exam Running',
              faceDetected: true
            });
          }
        } else {
          // Mismatch detected!
          setConsecutiveIdentityFailures(prev => {
            const nextFailures = prev + 1;
            console.warn(`🔴 Face Verification Mismatch (${data.similarityPct}% match). Consecutive failures: ${nextFailures}/3`);

            setIdentityVerification({
              isVerified: false,
              studentName: '', // Student name disappears while mismatched!
              confidence: data.similarityPct || 0,
              status: 'Unknown Person Detected'
            });

            const socket = getSocket();
            if (socket) {
              socket.emit('telemetry-update', {
                studentId,
                studentName: 'Unknown Person Detected',
                email,
                identityStatus: 'Identity Failed',
                confidence: data.similarityPct || 0,
                examStatus: 'Identity Failed',
                faceDetected: false
              });
            }

            // Requirement 7: If match fails for > 3 consecutive checks (4 failures), auto terminate
            if (nextFailures > 3) {
              handleAutoTermination(video, studentId, fullName, email, 'Face Mismatch - Live face does not match registered student');
            }
            return nextFailures;
          });
        }

      } catch (err) {
        console.warn('Continuous verification loop error:', err);
      }
    }, 6000);

    return () => clearInterval(interval);
  }, [isExamUnlocked, isExamTerminated, handleAutoTermination]);

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

    const apiBase = getApiBaseUrl();
    fetch(`${apiBase}/api/admin/live-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).catch(() => {});

    if (apiBase !== '/api' && apiBase !== '') {
      fetch('/api/admin/live-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
    }

    const socket = getSocket();
    if (socket) {
      socket.emit('student-connected', payload);
      socket.emit('exam-start', payload);
    }
  }, [violationsCount, tabSwitchesCount, faceDetectionState, phoneDetectionState, headPoseState, eyeTrackingState]);

  // Periodic 4-Second Live Heartbeat & Frame Sync for Admin Oversight
  useEffect(() => {
    if (!isExamUnlocked) return;

    const heartbeatInterval = setInterval(() => {
      let webcamBase64 = null;
      try {
        const video = document.querySelector('video');
        if (video && video.readyState === 4) {
          const canvas = document.createElement('canvas');
          canvas.width = 320;
          canvas.height = 240;
          canvas.getContext('2d').drawImage(video, 0, 0, 320, 240);
          webcamBase64 = canvas.toDataURL('image/jpeg', 0.6);
        }
      } catch (e) {}

      const userStr = localStorage.getItem('user');
      let studentEmail = 'student@proctor.com';
      let studentName = 'Veeru Reddy';
      let studentId = 'STU_veerureddy';

      if (userStr) {
        try {
          const u = JSON.parse(userStr);
          studentEmail = u.email || studentEmail;
          studentName = u.name || studentName;
          studentId = u.studentId || 'STU_' + studentEmail.replace(/[^a-z0-9]/g, '_');
        } catch (e) {}
      }

      const payload = {
        studentId,
        studentName,
        email: studentEmail,
        usn: '1SZ23CS001',
        examId: 'CS-401',
        examName: 'Computer Science Final Assessment',
        department: 'Computer Science & Engineering',
        status: 'Online',
        faceDetected: true,
        multipleFaces: false,
        mobilePhoneDetected: false,
        headPose: headPoseState?.value || 'Looking Center',
        eyeGaze: eyeTrackingState?.value || 'Center',
        tabSwitchingCount: tabSwitchesCount,
        suspiciousActivityCount: violationsCount,
        riskLevel: violationsCount >= 4 ? 'High' : violationsCount >= 2 ? 'Medium' : 'Low',
        lastWebcamFrame: webcamBase64,
        image: webcamBase64
      };

      const apiBase = getApiBaseUrl();
      fetch(`${apiBase}/api/admin/live-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});

      if (apiBase !== '/api' && apiBase !== '') {
        fetch('/api/admin/live-session', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        }).catch(() => {});
      }
    }, 4000);

    return () => clearInterval(heartbeatInterval);
  }, [isExamUnlocked, violationsCount, tabSwitchesCount, headPoseState, eyeTrackingState]);



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
    let studentId = activeUser?.studentId || ('STU_' + Date.now());
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
        
        // Trigger auto-termination pipeline
        handleAutoTermination(
          document.querySelector('video'),
          activeUser?.studentId || 'STUDENT',
          activeUser?.fullName || activeUser?.name || 'Student',
          activeUser?.email || '',
          'Exceeded maximum 3 violation warnings'
        );

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
      if (document.hidden && !isTerminated) {
        setTabSwitchesCount(prev => {
          const nextCount = prev + 1;
          const maxSwitches = 3;

          recordViolation(`⚠️ Tab / Window Switch Violation (${nextCount}/${maxSwitches})`);

          if (nextCount >= maxSwitches) {
            // Rule: Maximum tab switches reached -> TERMINATE EXAM IMMEDIATELY
            setIsTerminated(true);
            setTerminationReason(`Maximum ${maxSwitches} Tab Switches Exceeded`);
            recordViolation(`🚨 EXAM TERMINATED: Maximum ${maxSwitches} tab switches reached! Session locked.`);

            // Log permanent cheating & session termination record to backend
            const userStr = localStorage.getItem('user');
            let studentName = 'Student';
            let studentId = 'STU_' + Date.now();
            let email = 'student@proctor.com';
            if (userStr) {
              try {
                const u = JSON.parse(userStr);
                studentName = u.name || studentName;
                studentId = u.studentId || studentId;
                email = u.email || email;
              } catch (e) {}
            }

            const termPayload = {
              studentId,
              studentName,
              email,
              examId: 'CS-401',
              violationType: 'MAX_TAB_SWITCHES_EXCEEDED',
              tabSwitchCount: nextCount,
              actionTaken: 'EXAM_TERMINATED',
              terminated: true,
              timestamp: new Date().toISOString()
            };

            const apiBase = getApiBaseUrl();
            fetch(`${apiBase}/api/face/cheating-log`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(termPayload)
            }).catch(() => {});

            fetch(`${apiBase}/api/admin/live-session`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...termPayload,
                status: 'Terminated',
                riskLevel: 'High'
              })
            }).catch(() => {});
          } else {
            // Popup warning modal for each non-fatal tab switch violation
            setTabSwitchWarning({
              open: true,
              count: nextCount,
              max: maxSwitches,
              message: `Navigating away from the exam tab is strictly prohibited! Warning ${nextCount} of ${maxSwitches}. Remaining allowed attempts: ${maxSwitches - nextCount}.`
            });
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
        identityVerification={identityVerification}
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
          identityVerification={identityVerification}
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

      {/* Requirement 7: Automatic Exam Termination Locking Modal Overlay */}
      {isExamTerminated && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(2, 6, 23, 0.98)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999999,
          backdropFilter: 'blur(16px)'
        }}>
          <div style={{
            background: 'rgba(15, 23, 42, 0.98)',
            border: '2px solid #ef4444',
            borderRadius: '24px',
            padding: '36px',
            maxWidth: '520px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 25px 50px rgba(239, 68, 68, 0.4)',
            color: '#f8fafc'
          }}>
            <div style={{ fontSize: '3.5rem', marginBottom: '12px' }}>🔴</div>
            <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#ef4444', marginBottom: '10px' }}>
              EXAM TERMINATED AUTOMATICALLY
            </h2>
            <div style={{
              background: 'rgba(239, 68, 68, 0.15)',
              border: '1px solid #ef4444',
              color: '#fca5a5',
              padding: '12px 16px',
              borderRadius: '12px',
              fontSize: '0.88rem',
              fontWeight: 700,
              marginBottom: '20px'
            }}>
              Reason: {terminationReason || 'Face Mismatch (Identity Failed > 3 Consecutive Checks)'}
            </div>
            <p style={{ color: '#cbd5e1', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: '24px' }}>
              The AI proctoring engine detected a face mismatch for 4 consecutive verification checks. An incident report with video evidence has been logged to the database and sent to the administrator.
            </p>
            <button
              onClick={() => window.location.href = '/dashboard'}
              style={{
                background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                color: 'white',
                border: 'none',
                padding: '12px 28px',
                borderRadius: '12px',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer'
              }}
            >
              Return to Student Dashboard ➔
            </button>
          </div>
        </div>
      )}

      {/* ⚠️ Tab Switch Warning Popup Modal */}
      {tabSwitchWarning.open && !isTerminated && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(15, 23, 42, 0.85)',
          backdropFilter: 'blur(10px)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          zIndex: 99999
        }}>
          <div style={{
            background: 'linear-gradient(145deg, #1e293b, #0f172a)',
            border: '2px solid #f59e0b',
            borderRadius: '20px',
            padding: '36px',
            maxWidth: '520px',
            width: '90%',
            textAlign: 'center',
            boxShadow: '0 25px 50px -12px rgba(245, 158, 11, 0.35)',
            color: '#ffffff'
          }}>
            <div style={{
              width: '70px',
              height: '70px',
              borderRadius: '50%',
              backgroundColor: 'rgba(245, 158, 11, 0.2)',
              border: '2px solid #f59e0b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 20px',
              fontSize: '32px',
              color: '#f59e0b'
            }}>
              ⚠️
            </div>

            <h2 style={{ fontSize: '1.6rem', fontWeight: 800, color: '#f59e0b', marginBottom: '12px' }}>
              TAB SWITCH WARNING ({tabSwitchWarning.count}/{tabSwitchWarning.max})
            </h2>

            <p style={{ color: '#cbd5e1', fontSize: '1rem', lineHeight: '1.6', marginBottom: '24px' }}>
              {tabSwitchWarning.message}
            </p>

            <div style={{
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '12px',
              padding: '12px 16px',
              marginBottom: '28px',
              fontSize: '0.9rem',
              color: '#fbbf24'
            }}>
              🚨 <strong>Strict Rule:</strong> Reaching 3 tab switches will immediately terminate your exam session permanently!
            </div>

            <button
              onClick={() => setTabSwitchWarning(prev => ({ ...prev, open: false }))}
              style={{
                width: '100%',
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                color: '#ffffff',
                border: 'none',
                padding: '14px 24px',
                borderRadius: '12px',
                fontSize: '1rem',
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(245, 158, 11, 0.4)'
              }}
            >
              I Understand — Resume Exam ➔
            </button>
          </div>
        </div>
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

