import { useState, useEffect, useRef, useCallback } from 'react';
import { loadFaceModels, captureFaceDescriptor } from '../services/faceVerificationService';
import { getApiBaseUrl } from '../utils/config';

export function useContinuousVerification({
  webcamRef,
  studentId,
  token,
  isActive = true,
  intervalMs = 3000,
  onViolation
}) {
  const [verificationResult, setVerificationResult] = useState({
    status: 'idle', // idle | verified | mismatch | no_face | no_face_critical
    confidence: 0,
    message: 'Initializing face verification...',
  });

  const noFaceTimerRef = useRef(null);
  const consecutiveMatchesRef = useRef(0);
  const consecutiveFailsRef = useRef(0);
  const isRunningRef = useRef(false);

  const verifyFrame = useCallback(async () => {
    if (!webcamRef?.current?.video || !studentId || !token) return;
    const video = webcamRef.current.video;
    if (video.readyState < 2) return;

    try {
      const descriptor = await captureFaceDescriptor(video);

      if (!descriptor) {
        consecutiveMatchesRef.current = 0; // reset match counter
        consecutiveFailsRef.current += 1;  // increment fail counter
        if (!noFaceTimerRef.current) {
          noFaceTimerRef.current = Date.now();
        }
        const secondsNoFace = (Date.now() - noFaceTimerRef.current) / 1000;
        const isCritical = secondsNoFace >= 5;

        const newStatus = isCritical ? 'no_face_critical' : 'no_face';
        const msg = isCritical
          ? `⚠️ No face detected for ${secondsNoFace.toFixed(0)}s (Exceeded 5s threshold!)`
          : `No face detected (${secondsNoFace.toFixed(0)}s)`;

        setVerificationResult({
          status: newStatus,
          confidence: 0,
          message: msg,
          secondsNoFace
        });

        if (isCritical && onViolation) {
          onViolation({
            type: 'no_face',
            severity: 'high',
            description: msg,
            timestamp: new Date().toISOString()
          });
        }
      } else {
        // Reset no face timer
        noFaceTimerRef.current = null;

        // Verify descriptor against backend
        const apiBase = getApiBaseUrl();
        const response = await fetch(`${apiBase}/api/face/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ studentId, embedding: Array.from(descriptor) })
        });

        const contentType = response.headers.get('content-type') || '';
        let data = { match: false, confidence: 0 };
        if (contentType.includes('application/json')) {
          data = await response.json();
        }


        if (data.needsEnrollment) {
          consecutiveMatchesRef.current = 0;
          setVerificationResult({
            status: 'not_enrolled',
            confidence: 0,
            message: 'No face registered. Enrollment required.'
          });
          return;
        }

        const match = data.match;
        if (match) {
          consecutiveMatchesRef.current += 1;
          consecutiveFailsRef.current = 0; // Reset fail counter on success
        } else {
          consecutiveMatchesRef.current = 0;
          consecutiveFailsRef.current += 1; // Increment fail counter
        }

        const isTemporallyVerified = consecutiveMatchesRef.current >= 5;
        const status = isTemporallyVerified ? 'verified' : match ? 'verifying' : 'mismatch';
        const simPct = Math.round((data.similarity || 0) * 100);
        const displayMsg = match
          ? `Face Match: ${simPct}% (${consecutiveMatchesRef.current}/5 frames)`
          : `Face Mismatch (${simPct}% similarity - Fail ${consecutiveFailsRef.current}/3)`;

        setVerificationResult({
          status,
          confidence: data.confidence || 0,
          similarityPct: simPct,
          message: displayMsg,
          distance: data.distance,
          consecutiveMatches: consecutiveMatchesRef.current,
          consecutiveFails: consecutiveFailsRef.current
        });

        // Trigger continuous mismatch pause if 3 consecutive failures occur
        if (consecutiveFailsRef.current >= 3 && onViolation) {
          onViolation({
            type: 'continuous_mismatch_pause',
            severity: 'critical',
            description: `⚠️ Identity Mismatch: 3 Consecutive 5s Checks Below Similarity Threshold (${simPct}% similarity). Re-verification Required!`,
            confidence: data.confidence,
            timestamp: new Date().toISOString()
          });
        } else if (!match && onViolation) {
          onViolation({
            type: 'face_mismatch',
            severity: 'high',
            description: displayMsg,
            confidence: data.confidence,
            timestamp: new Date().toISOString()
          });
        }
      }
    } catch (err) {
      console.error('Continuous verification error:', err);
    }
  }, [webcamRef, studentId, token, onViolation]);

  useEffect(() => {
    if (!isActive) {
      isRunningRef.current = false;
      return;
    }

    isRunningRef.current = true;
    loadFaceModels();

    const interval = setInterval(() => {
      if (isRunningRef.current) {
        verifyFrame();
      }
    }, intervalMs);

    return () => {
      isRunningRef.current = false;
      clearInterval(interval);
    };
  }, [isActive, intervalMs, verifyFrame]);

  return verificationResult;
}
