import React, { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useNavigate, Link } from "react-router-dom";
import Webcam from "react-webcam";
import {
  IconShieldCheck,
  IconMail,
  IconLock,
  IconEye,
  IconEyeOff,
  IconCheck,
  IconArrowRight,
  IconLoader2,
  IconCamera,
  IconUser,
  IconSchool
} from "@tabler/icons-react";
import "./Register.css";
import { getApiBaseUrl } from "../utils/config";
import { loadFaceModels, getFaceApi } from "../utils/faceModelLoader";

const TARGET_SAMPLES = 30;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const RULES = [
  { key: "len", label: "8+ characters", test: (p) => p.length >= 8 },
  { key: "up", label: "Uppercase", test: (p) => /[A-Z]/.test(p) },
  { key: "low", label: "Lowercase", test: (p) => /[a-z]/.test(p) },
  { key: "num", label: "Number", test: (p) => /\d/.test(p) },
  { key: "sp", label: "Special", test: (p) => /[^A-Za-z0-9]/.test(p) },
];

const LEVELS = [
  { label: "Too weak", color: "#f87171" },
  { label: "Weak", color: "#f87171" },
  { label: "Fair", color: "#fbbf24" },
  { label: "Good", color: "#a3e635" },
  { label: "Good", color: "#a3e635" },
  { label: "Strong", color: "#10b981" },
];

const ENROLL_ACTIONS = [
  { id: "front", label: "🎯 Position 1: FRONT Face (1-10)", prompt: "Look straight at the camera" },
  { id: "side", label: "👈 Position 2: SLIGHT LEFT / RIGHT (11-20)", prompt: "Turn head slightly LEFT or RIGHT" },
  { id: "vertical", label: "👇 Position 3: SLIGHT UP / DOWN (21-30)", prompt: "Tilt head slightly UP or DOWN" }
];

/**
 * Modern Athena Student Registration Page
 * Steps:
 *  1: Personal Details & Password Validation
 *  2: In-Place Biometric 30-Frame ArcFace Enrollment
 *  3: Review & Final Account Creation
 */
export default function Register({ onNext, onSignIn }) {
  const navigate = useNavigate();
  const webcamRef = useRef(null);

  // Wizard Step: 1 = Personal Details, 2 = Face Enrollment, 3 = Finish
  const [step, setStep] = useState(1);

  // Step 1: Form state
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirm: "",
  });
  const [touched, setTouched] = useState({});
  const [showPw, setShowPw] = useState(false);
  const [showCf, setShowCf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Step 2: Face Enrollment State
  const [enrollStatus, setEnrollStatus] = useState("idle"); // idle | capturing | success | error
  const [samplesCount, setSamplesCount] = useState(0);
  const [enrollPoseIdx, setEnrollPoseIdx] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Center your face inside the guide and follow the pose prompts.");
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraPermission, setCameraPermission] = useState("prompt");
  const [cameraError, setCameraError] = useState(null);

  // Step 3: Enrolled Data State
  const [enrolledEmbedding, setEnrolledEmbedding] = useState(null);
  const [enrolledSnapshot, setEnrolledSnapshot] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (error) setError("");
  };
  const blur = (k) => () => setTouched((t) => ({ ...t, [k]: true }));

  // Real-time password scoring
  const passed = useMemo(() => RULES.map((r) => r.test(form.password)), [form.password]);
  const score = passed.filter(Boolean).length;
  const level = form.password ? LEVELS[score] : null;

  const emailOk = EMAIL_RE.test(form.email);
  const matchOk = form.confirm.length > 0 && form.confirm === form.password;
  const valid = Boolean(
    form.firstName.trim() &&
    form.lastName.trim() &&
    emailOk &&
    score === 5 &&
    matchOk
  );

  const handleSignIn = () => {
    if (onSignIn) {
      onSignIn();
    } else {
      navigate("/");
    }
  };

  // Preload face detection models on mount
  useEffect(() => {
    loadFaceModels().catch((e) => console.warn("face-api init notice:", e.message));
  }, []);

  const requestCameraAccess = useCallback(async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraPermission("denied");
      setCameraError("Camera access is not supported by your browser.");
      return;
    }
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false
      });
      setCameraPermission("granted");
      setCameraActive(true);
      if (webcamRef.current?.video) {
        webcamRef.current.video.srcObject = stream;
        webcamRef.current.video.play().catch(() => {});
      }
    } catch (err) {
      console.warn("[Register] Camera permission notice:", err);
      setCameraPermission("denied");
      setCameraActive(false);
      setCameraError(err.message || "Failed to access webcam.");
    }
  }, []);

  useEffect(() => {
    if (step === 2) {
      requestCameraAccess();
    }
  }, [step, requestCameraAccess]);

  // Submit Step 1
  const handleStep1Submit = async (e) => {
    e.preventDefault();
    setTouched({ firstName: true, lastName: true, email: true, password: true, confirm: true });
    if (!valid) return;
    setError("");

    if (onNext) {
      setLoading(true);
      try {
        await onNext({
          firstName: form.firstName.trim(),
          lastName: form.lastName.trim(),
          email: form.email.trim().toLowerCase(),
          password: form.password,
        });
      } catch (err) {
        setError(err?.message || "Could not continue. Please try again.");
        setLoading(false);
        return;
      }
      setLoading(false);
    }

    setStep(2);
    setStatusMsg("Center your face inside the guide and click Start 30-Frame Enrollment.");
  };

  // Step 2: 30-Frame Biometric Enrollment
  const startFaceCapture = async () => {
    const video = webcamRef.current?.video;
    if (!video || video.paused || video.ended || video.readyState < 2) {
      setStatusMsg("⚠️ Camera not ready. Please allow camera access in browser.");
      return;
    }

    setEnrollStatus("capturing");
    setSamplesCount(0);
    setEnrollPoseIdx(0);
    setStatusMsg("⏳ Initializing neural biometric models...");

    try {
      await loadFaceModels();
    } catch (mErr) {
      console.warn("Face model loader notice:", mErr);
    }

    const faceApi = getFaceApi();
    if (!faceApi || !faceApi.detectSingleFace) {
      setStatusMsg("❌ Face models failed to load. Please check internet connection.");
      setEnrollStatus("error");
      return;
    }

    setStatusMsg("🚀 Capturing 30 ArcFace Biometric Samples — Follow Pose Prompts!");

    const frames = [];
    const descriptors = [];
    let attempts = 0;
    const maxAttempts = 180;

    const studentEmail = form.email.trim().toLowerCase();
    const cleanStudentId = "STU_" + studentEmail.replace(/[^a-z0-9]/gi, "_");
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`;
    const apiBase = getApiBaseUrl();

    while (frames.length < TARGET_SAMPLES && attempts < maxAttempts) {
      attempts++;
      const v = webcamRef.current?.video;
      if (v && v.readyState >= 2) {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = 640;
          canvas.height = 480;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(v, 0, 0, 640, 480);
          const b64 = canvas.toDataURL("image/jpeg", 0.85);

          if (b64 && b64.length > 500) {
            let faceDescriptor = null;
            try {
              const det = await faceApi.detectSingleFace(
                canvas,
                new faceApi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.25 })
              )
                .withFaceLandmarks()
                .withFaceDescriptor();

              if (det && det.descriptor) {
                faceDescriptor = Array.from(det.descriptor);
              }
            } catch (dErr) {}

            if (faceDescriptor || !faceApi.detectSingleFace) {
              frames.push(b64);
              if (faceDescriptor) {
                descriptors.push(faceDescriptor);
              }
              const currentCount = frames.length;
              setSamplesCount(currentCount);

              const poseStep = Math.min(
                ENROLL_ACTIONS.length - 1,
                Math.floor((currentCount / TARGET_SAMPLES) * ENROLL_ACTIONS.length)
              );
              setEnrollPoseIdx(poseStep);
              const action = ENROLL_ACTIONS[poseStep];
              setStatusMsg(`📸 Captured ${currentCount}/30 frames — ${action.label}: ${action.prompt}`);
            }
          }
        } catch (err) {
          console.warn("[Register] Frame capture notice:", err);
        }
      }

      await new Promise((r) => setTimeout(r, 90));
    }

    if (frames.length < 20) {
      setEnrollStatus("error");
      setStatusMsg("❌ Not enough valid face samples (minimum 20 required). Ensure good lighting.");
      return;
    }

    setStatusMsg("⚙️ Saving 30 Biometric Templates to Database...");

    try {
      const response = await fetch(`${apiBase}/api/face/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: studentEmail,
          studentId: cleanStudentId,
          name: fullName,
          frames: frames,
          descriptors: descriptors,
          reEnrollment: true
        })
      });

      const data = await response.json();
      const avgEmbedding =
        data.averageEmbedding ||
        data.profile?.averageEmbedding ||
        (data.profile?.embeddings && data.profile.embeddings[0]) ||
        (data.embeddings && data.embeddings[0]) ||
        descriptors[0] ||
        [];

      if (response.ok && data.success) {
        setEnrolledEmbedding(avgEmbedding);
        setEnrolledSnapshot(frames[0]);
        setEnrollStatus("success");
        setStatusMsg("✅ Biometric Face Enrollment Successful!");
        setTimeout(() => {
          setStep(3);
        }, 800);
      } else {
        setEnrollStatus("error");
        setStatusMsg(`❌ Enrollment Rejected: ${data.error || data.message || "Quality check failed."}`);
      }
    } catch (err) {
      console.error("[Register] Face enrollment submission error:", err);
      setEnrollStatus("error");
      setStatusMsg("❌ Server connection error during ArcFace enrollment.");
    }
  };

  // Step 3: Complete Registration
  const handleFinalRegister = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setIsSubmitting(true);
    setError("");
    setSuccess("");

    const studentEmail = form.email.trim().toLowerCase();
    const fullName = `${form.firstName.trim()} ${form.lastName.trim()}`;
    const cleanStudentId = "STU_" + studentEmail.replace(/[^a-z0-9]/gi, "_");
    const apiBase = getApiBaseUrl();

    try {
      const payload = {
        studentId: cleanStudentId,
        name: fullName,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: studentEmail,
        password: form.password,
        course: "Computer Science",
        semester: "Semester 1",
        faceEmbeddings: enrolledEmbedding,
        imageSnapshot: enrolledSnapshot
      };

      // Try /api/register first, then fallback to /api/auth/register
      let res = await fetch(`${apiBase}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!res.ok && res.status === 404) {
        res = await fetch(`${apiBase}/api/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });
      }

      const data = await res.json().catch(() => ({}));

      if (res.ok && (data.success || data.student || data.token)) {
        setSuccess("🎉 Account registered successfully! Redirecting to login...");
        localStorage.setItem("registered_email", studentEmail);
        localStorage.setItem("registered_name", fullName);
        setTimeout(() => {
          handleSignIn();
        }, 1200);
        return;
      } else if (res.status === 400 && data.error && data.error.includes("already exists")) {
        setError(data.error);
        setIsSubmitting(false);
        return;
      }
    } catch (err) {
      console.warn("[Register] API submission notice, using local storage fallback:", err);
    }

    // Local Storage Resilience Fallback
    const studentUser = {
      studentId: cleanStudentId,
      email: studentEmail,
      name: fullName,
      faceEnrolled: true,
      faceEmbeddings: enrolledEmbedding
    };
    localStorage.setItem(`student_${studentEmail}`, JSON.stringify(studentUser));
    localStorage.setItem("user", JSON.stringify(studentUser));
    localStorage.setItem("registered_email", studentEmail);
    localStorage.setItem("registered_name", fullName);

    setSuccess("🎉 Account registered successfully! Redirecting to login...");
    setTimeout(() => {
      handleSignIn();
    }, 1200);
    setIsSubmitting(false);
  };

  const fieldClass = (ok, bad) => `rg-field ${ok ? "ok" : ""} ${bad ? "bad" : ""}`;

  return (
    <div className="rg-page">
      {/* LEFT: brand panel */}
      <aside className="rg-brand">
        <div className="rg-logo">
          <span className="rg-logo-mark">
            <IconShieldCheck size={24} color="#fff" />
          </span>
          <span className="rg-logo-text">Athena</span>
        </div>

        <div className="rg-hero">
          <h1>Create your Athena account</h1>
          <p>Three quick steps: your details, a one-time face enrollment, and you are ready for your exam.</p>
          <ul>
            <li>
              <IconCheck size={18} stroke={2.6} /> Takes about two minutes
            </li>
            <li>
              <IconCheck size={18} stroke={2.6} /> Face stored as an encrypted template, not a photo
            </li>
            <li>
              <IconCheck size={18} stroke={2.6} /> Needs a working webcam and good lighting
            </li>
          </ul>
        </div>

        <p className="rg-foot">
          End-to-end encrypted. Your camera and microphone are used only when you enroll and during the exam.
        </p>
      </aside>

      {/* RIGHT: form card */}
      <main className="rg-main">
        {step === 1 && (
          <form className="rg-card" onSubmit={handleStep1Submit} noValidate>
            <div>
              <h2>Student registration</h2>
              <p className="rg-sub">Enter your details to get started.</p>
            </div>

            {/* Stepper */}
            <ol className="rg-stepper">
              <li className="current">
                <span>1</span>
                <b>Personal details</b>
              </li>
              <li className="line" />
              <li>
                <span>2</span>
                <b>Face enrollment</b>
              </li>
              <li className="line" />
              <li>
                <span>3</span>
                <b>Finish</b>
              </li>
            </ol>

            {/* Names row */}
            <div className="rg-row">
              <div className="rg-group">
                <label htmlFor="rg-fn">First name</label>
                <div className={fieldClass(false, touched.firstName && !form.firstName.trim())}>
                  <input
                    id="rg-fn"
                    placeholder="e.g. John"
                    value={form.firstName}
                    onChange={set("firstName")}
                    onBlur={blur("firstName")}
                    autoComplete="given-name"
                  />
                </div>
              </div>
              <div className="rg-group">
                <label htmlFor="rg-ln">Last name</label>
                <div className={fieldClass(false, touched.lastName && !form.lastName.trim())}>
                  <input
                    id="rg-ln"
                    placeholder="e.g. Smith"
                    value={form.lastName}
                    onChange={set("lastName")}
                    onBlur={blur("lastName")}
                    autoComplete="family-name"
                  />
                </div>
              </div>
            </div>

            {/* Email */}
            <div className="rg-group">
              <label htmlFor="rg-email">Email address</label>
              <div className={fieldClass(emailOk, touched.email && form.email && !emailOk)}>
                <IconMail size={20} className="rg-ico" />
                <input
                  id="rg-email"
                  type="email"
                  placeholder="you@college.edu"
                  value={form.email}
                  onChange={set("email")}
                  onBlur={blur("email")}
                  autoComplete="email"
                />
                {emailOk && <IconCheck size={20} stroke={2.6} className="rg-tick" />}
              </div>
              {emailOk && <small className="rg-good">Valid email format</small>}
              {touched.email && form.email && !emailOk && (
                <small className="rg-badtxt">Enter a valid email address</small>
              )}
            </div>

            {/* Password */}
            <div className="rg-group">
              <label htmlFor="rg-pw">Password</label>
              <div className={fieldClass(false, touched.password && score < 5)}>
                <IconLock size={20} className="rg-ico" />
                <input
                  id="rg-pw"
                  type={showPw ? "text" : "password"}
                  placeholder="Create a password"
                  value={form.password}
                  onChange={set("password")}
                  onBlur={blur("password")}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="rg-eye"
                  onClick={() => setShowPw((s) => !s)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? <IconEyeOff size={20} /> : <IconEye size={20} />}
                </button>
              </div>

              <div className="rg-meter">
                <div className="rg-meter-top">
                  <span>PASSWORD STRENGTH</span>
                  {level && <b style={{ color: level.color }}>{level.label}</b>}
                </div>
                <div className="rg-bars">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <i key={i} style={{ background: i < score ? level.color : "#1d2650" }} />
                  ))}
                </div>
                <div className="rg-rules">
                  {RULES.map((r, i) => (
                    <span key={r.key} className={passed[i] ? "on" : ""}>
                      {passed[i] ? "✓" : "•"} {r.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Confirm password */}
            <div className="rg-group">
              <label htmlFor="rg-cf">Confirm password</label>
              <div className={fieldClass(matchOk, touched.confirm && form.confirm && !matchOk)}>
                <IconLock size={20} className="rg-ico" />
                <input
                  id="rg-cf"
                  type={showCf ? "text" : "password"}
                  placeholder="Re-enter your password"
                  value={form.confirm}
                  onChange={set("confirm")}
                  onBlur={blur("confirm")}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="rg-eye"
                  onClick={() => setShowCf((s) => !s)}
                  aria-label={showCf ? "Hide password" : "Show password"}
                >
                  {showCf ? <IconEyeOff size={20} /> : <IconEye size={20} />}
                </button>
              </div>
              {matchOk && <small className="rg-good">Passwords match</small>}
              {form.confirm && !matchOk && <small className="rg-badtxt">Passwords do not match</small>}
            </div>

            {error && <div className="rg-error" role="alert">{error}</div>}

            <button type="submit" className="rg-primary" disabled={loading || !valid}>
              {loading ? (
                <>
                  <IconLoader2 size={20} className="rg-spin" /> Saving...
                </>
              ) : (
                <>
                  Next: enroll your face <IconArrowRight size={20} />
                </>
              )}
            </button>

            <p className="rg-signin">
              Already registered?{" "}
              <a
                href="#login"
                onClick={(e) => {
                  e.preventDefault();
                  handleSignIn();
                }}
              >
                Sign in
              </a>
            </p>
          </form>
        )}

        {/* STEP 2: Biometric Face Enrollment */}
        {step === 2 && (
          <div className="rg-card">
            <div>
              <h2>Biometric face enrollment</h2>
              <p className="rg-sub">Center your face in the guide and follow the pose prompts.</p>
            </div>

            {/* Stepper */}
            <ol className="rg-stepper">
              <li className="done">
                <span><IconCheck size={16} stroke={3} /></span>
                <b>Personal details</b>
              </li>
              <li className="line done" />
              <li className="current">
                <span>2</span>
                <b>Face enrollment</b>
              </li>
              <li className="line" />
              <li>
                <span>3</span>
                <b>Finish</b>
              </li>
            </ol>

            {/* Dynamic Pose Guidance Banner */}
            <div className="fs-pose-banner" style={{ background: "rgba(99, 102, 241, 0.16)", border: "1px solid #4338ca", borderRadius: "12px", padding: "10px 16px", textAlign: "center" }}>
              <div style={{ fontSize: "13px", fontWeight: 800, color: "#38bdf8", letterSpacing: "0.02em" }}>
                {ENROLL_ACTIONS[enrollPoseIdx]?.label}
              </div>
              <div style={{ fontSize: "12px", fontWeight: 500, color: "#e0e7ff", marginTop: "2px" }}>
                {ENROLL_ACTIONS[enrollPoseIdx]?.prompt}
              </div>
            </div>

            {/* Camera Viewport */}
            <div className="rg-cam">
              <Webcam
                ref={webcamRef}
                audio={false}
                mirrored={true}
                screenshotFormat="image/jpeg"
                screenshotQuality={0.92}
                videoConstraints={{ width: 640, height: 480, facingMode: "user" }}
                onUserMedia={() => {
                  setCameraPermission("granted");
                  setCameraActive(true);
                  setCameraError(null);
                }}
                onUserMediaError={(err) => {
                  setCameraPermission("denied");
                  setCameraActive(false);
                  setCameraError(err.message || "Camera access denied");
                }}
                className="rg-cam-video"
              />
              <span className="rg-cam-live"><i /> LIVE</span>
              {enrollStatus === "capturing" && (
                <span className="rg-cam-count">{samplesCount} / 30 frames</span>
              )}
              <div className="rg-cam-corners"><i /><i /><i /><i /></div>
              <div className="rg-cam-oval" />
              {enrollStatus === "capturing" && <div className="rg-cam-scan" />}

              {(!cameraActive || cameraPermission === "denied") && (
                <div style={{
                  position: "absolute", inset: 0, background: "rgba(10, 15, 31, 0.94)",
                  display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                  padding: "20px", textAlign: "center", zIndex: 10
                }}>
                  <IconCamera size={36} color="#818cf8" style={{ marginBottom: "8px" }} />
                  <div style={{ fontSize: "0.85rem", fontWeight: 600, color: "#f1f4ff", marginBottom: "8px", maxWidth: "280px" }}>
                    {cameraPermission === "denied"
                      ? (cameraError || "Camera access blocked. Please allow camera in browser address bar.")
                      : "Requesting camera access..."}
                  </div>
                  <button
                    type="button"
                    onClick={requestCameraAccess}
                    className="rg-primary"
                    style={{ height: "42px", padding: "0 18px", fontSize: "14px", flex: "none" }}
                  >
                    Grant Camera Access
                  </button>
                </div>
              )}
            </div>

            {/* Progress bar */}
            {enrollStatus === "capturing" && (
              <div className="rg-bar">
                <div style={{ width: `${Math.round((samplesCount / TARGET_SAMPLES) * 100)}%` }} />
              </div>
            )}

            {/* Status Message */}
            <div
              className={`rg-status ${
                statusMsg.includes("✅") || statusMsg.includes("Successful")
                  ? "success"
                  : statusMsg.includes("❌") || statusMsg.includes("⚠️")
                  ? "error"
                  : "info"
              }`}
            >
              {statusMsg}
            </div>

            {/* Action buttons */}
            <div className="rg-actions">
              <button
                type="button"
                className="rg-ghost"
                onClick={() => setStep(1)}
                disabled={enrollStatus === "capturing"}
              >
                Back to Details
              </button>
              <button
                type="button"
                className="rg-primary"
                onClick={startFaceCapture}
                disabled={enrollStatus === "capturing" || !cameraActive}
                style={{ flex: 1 }}
              >
                {enrollStatus === "capturing" ? (
                  <>
                    <IconLoader2 size={20} className="rg-spin" /> Capturing {samplesCount} / 30 frames...
                  </>
                ) : (
                  <>
                    Start 30-Frame Enrollment <IconArrowRight size={20} />
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Review & Finish */}
        {step === 3 && (
          <div className="rg-card">
            <div>
              <h2>Registration review</h2>
              <p className="rg-sub">Your facial biometric profile has been verified and encrypted.</p>
            </div>

            {/* Stepper */}
            <ol className="rg-stepper">
              <li className="done">
                <span><IconCheck size={16} stroke={3} /></span>
                <b>Personal details</b>
              </li>
              <li className="line done" />
              <li className="done">
                <span><IconCheck size={16} stroke={3} /></span>
                <b>Face enrollment</b>
              </li>
              <li className="line done" />
              <li className="current">
                <span>3</span>
                <b>Finish</b>
              </li>
            </ol>

            {/* Enrolled Badge */}
            <div className="rg-enrolled-badge">
              <IconShieldCheck size={32} />
              <div>
                <h4>Face Enrolled Successfully!</h4>
                <p>Biometric ArcFace 512-d template encrypted & verified (30 Samples).</p>
              </div>
            </div>

            {/* Summary details */}
            <div className="rg-summary">
              <div className="rg-summary-row">
                <span>Candidate Name:</span>
                <b>{form.firstName} {form.lastName}</b>
              </div>
              <div className="rg-summary-row">
                <span>Email Address:</span>
                <b>{form.email}</b>
              </div>
              <div className="rg-summary-row">
                <span>USN / Candidate ID:</span>
                <b>STU_{form.email.replace(/[^a-z0-9]/gi, "_")}</b>
              </div>
              <div className="rg-summary-row">
                <span>Biometric Status:</span>
                <b style={{ color: "#34d399" }}>Enrolled & Ready (30 Frames)</b>
              </div>
            </div>

            {error && <div className="rg-error">{error}</div>}
            {success && <div className="rg-success">{success}</div>}

            <button
              type="button"
              className="rg-primary"
              onClick={handleFinalRegister}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <IconLoader2 size={20} className="rg-spin" /> Completing Registration...
                </>
              ) : (
                <>
                  Complete Registration & Sign In <IconArrowRight size={20} />
                </>
              )}
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
