import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/config';
import { getSocket } from '../services/socketService';

export default function AdminMonitor() {
  const [activeNav, setActiveNav] = useState('live');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(true);

  const [students, setStudents] = useState([]);
  const [violations, setViolations] = useState([]);
  const [finishedStudents, setFinishedStudents] = useState([]);
  const [terminatedStudents, setTerminatedStudents] = useState([]);
  const [selectedStudentDetail, setSelectedStudentDetail] = useState(null);
  const [watchingStudent, setWatchingStudent] = useState(null);
  const [evidenceModalImage, setEvidenceModalImage] = useState(null);

  const [metrics, setMetrics] = useState({
    activeExams: 3,
    activeStudents: 12,
    violationsToday: 18,
    highRiskStudents: 2,
    examsCompleted: 14
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [actionMessage, setActionMessage] = useState('');

  const fetchData = async () => {
    try {
      const apiBase = getApiBaseUrl();
      const [studentsRes, analyticsRes, violationsRes, finishedRes, terminatedRes] = await Promise.all([
        axios.get(`${apiBase}/api/admin/students/live`).catch(() => null),
        axios.get(`${apiBase}/api/admin/analytics`).catch(() => null),
        axios.get(`${apiBase}/api/admin/violations`).catch(() => null),
        axios.get(`${apiBase}/api/admin/finished`).catch(() => null),
        axios.get(`${apiBase}/api/admin/terminated`).catch(() => null)
      ]);

      if (studentsRes?.data?.success) {
        setStudents(studentsRes.data.students || []);
      }

      if (analyticsRes?.data?.success && analyticsRes.data.metrics) {
        setMetrics(analyticsRes.data.metrics);
      }

      if (violationsRes?.data?.success) {
        setViolations(violationsRes.data.violations || []);
      }

      if (finishedRes?.data?.success) {
        setFinishedStudents(finishedRes.data.finishedStudents || []);
      }

      if (terminatedRes?.data?.success) {
        setTerminatedStudents(terminatedRes.data.terminatedStudents || []);
      }
    } catch (error) {
      console.error('Error loading admin live data:', error);
    }
  };

  useEffect(() => {
    fetchData();
    const socket = getSocket();
    if (socket) {
      socket.emit('join_admin');
      
      socket.on('multi-face-violation', (data) => {
        setViolations(prev => [{
          id: "VIO_" + Date.now(),
          studentName: data.studentName || data.studentId || 'Student',
          usn: data.usn || data.studentId || 'STU_LIVE',
          email: data.studentEmail || 'student@university.edu',
          examName: data.examId || 'Computer Science Final Assessment',
          violationType: 'MULTIPLE FACES',
          confidence: '95.0%',
          time: new Date(data.timestamp || Date.now()).toLocaleTimeString(),
          date: new Date().toLocaleDateString(),
          severity: data.status === 'Exam Terminated' ? 'critical' : 'high',
          status: 'Flagged',
          screenshot: data.screenshot
        }, ...prev]);
      });

      socket.on('video-stream', (data) => {
        setStudents(prev => {
          const idx = prev.findIndex(s => s.studentId === data.studentId || s.email === data.email);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], image: data.image };
            return updated;
          }
          return prev;
        });
      });

      socket.on('telemetry-update', (data) => {
        setStudents(prev => {
          const idx = prev.findIndex(s => s.studentId === data.studentId || s.email === data.email);
          const studentObj = {
            studentId: data.studentId,
            studentName: data.studentName || data.fullName || 'Student',
            usn: data.usn || 'STU_STUDENT',
            email: data.email || 'student@gmail.com',
            department: data.department || 'Computer Science',
            verificationStatus: data.identityStatus || (data.faceDetected ? 'Verified' : 'Identity Failed'),
            faceMatchConfidence: data.confidence || (data.faceDetected ? 98 : 35),
            status: data.status || (data.examStatus === 'Terminated' ? 'Terminated' : 'Online'),
            warningsCount: data.warningsCount || 0,
            image: data.image || null,
            faceDetected: data.faceDetected !== undefined ? data.faceDetected : true,
            multipleFaces: data.multipleFaces || false,
            mobilePhoneDetected: data.mobilePhoneDetected || false,
            fullScreenStatus: data.fullScreenStatus || 'Active',
            headPose: data.headPose || 'Looking Center',
            eyeGaze: data.eyeGaze || 'Looking Center',
            riskLevel: data.riskLevel || 'Safe (0-20)'
          };

          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...studentObj };
            return updated;
          }
          return [studentObj, ...prev];
        });
      });

      socket.on('student-finished', (data) => {
        setFinishedStudents(prev => [data, ...prev.filter(s => s.studentId !== data.studentId)]);
        setStudents(prev => prev.filter(s => s.studentId !== data.studentId && s.email !== data.email));
      });

      socket.on('exam-finished', (data) => {
        setFinishedStudents(prev => [data, ...prev.filter(s => s.studentId !== data.studentId)]);
        setStudents(prev => prev.filter(s => s.studentId !== data.studentId && s.email !== data.email));
      });

      socket.on('student-terminated', (data) => {
        setTerminatedStudents(prev => [data, ...prev.filter(s => s.studentId !== data.studentId)]);
        setStudents(prev => prev.filter(s => s.studentId !== data.studentId && s.email !== data.email));
      });
    }

    const interval = setInterval(fetchData, 6000);
    return () => clearInterval(interval);
  }, []);

  const handleWarnStudent = (student) => {
    setStudents(prev => prev.map(s => {
      if (s.studentId === student.studentId || s.email === student.email) {
        const nextWarnings = (s.warningsCount || 0) + 1;
        return {
          ...s,
          warningsCount: nextWarnings,
          status: 'Warning',
          riskLevel: nextWarnings >= 2 ? 'Medium (20-50)' : s.riskLevel
        };
      }
      return s;
    }));
    setActionMessage(`⚠️ Warning issued to ${student.studentName} (${student.usn})`);
    setTimeout(() => setActionMessage(''), 4000);
  };

  const handleTerminateStudent = (student) => {
    setStudents(prev => prev.map(s => {
      if (s.studentId === student.studentId || s.email === student.email) {
        return {
          ...s,
          status: 'Terminated',
          verificationStatus: 'Identity Failed',
          riskLevel: 'High Risk (50+)'
        };
      }
      return s;
    }));
    setActionMessage(`🔴 Exam session terminated for ${student.studentName} (${student.usn})`);
    setTimeout(() => setActionMessage(''), 4000);
  };

  const handleOpenStudentDetail = (student) => {
    setSelectedStudentDetail(student);
    setActiveNav('studentDetail');
  };

  const filteredStudents = students.filter((s) => {
    const isOnline = s.status === 'Online' || s.status === 'Active' || s.status === 'Warning' || s.isOnline || (s.examStatus && s.examStatus !== 'Terminated');

    const matchesSearch =
      s.studentName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.usn?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.department?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRisk =
      riskFilter === 'ALL' ||
      (riskFilter === 'SAFE' && (s.riskLevel?.includes('Safe') || s.riskLevel?.includes('Low'))) ||
      (riskFilter === 'MEDIUM' && (s.riskLevel?.includes('Medium') || s.status === 'Warning')) ||
      (riskFilter === 'HIGH' && (s.riskLevel?.includes('High') || s.status === 'Terminated'));

    return isOnline && matchesSearch && matchesRisk;
  });

  return (
    <div style={styles.appWrapper}>
      {/* Scoped Reset to permanently eliminate any white button background leakage */}
      <style>{`
        .athena-sidebar-btn {
          background-color: transparent !important;
          background: transparent !important;
          border: 1px solid transparent !important;
          color: #94a3b8 !important;
          box-shadow: none !important;
          outline: none !important;
        }
        .athena-sidebar-btn:hover {
          background-color: rgba(255, 255, 255, 0.05) !important;
          background: rgba(255, 255, 255, 0.05) !important;
          color: #ffffff !important;
        }
        .athena-sidebar-btn.active {
          background-color: rgba(99, 102, 241, 0.18) !important;
          background: rgba(99, 102, 241, 0.18) !important;
          color: #818cf8 !important;
          border-left: 3px solid #6366f1 !important;
          font-weight: 800 !important;
        }
        .athena-sidebar-btn.exit-btn {
          color: #f87171 !important;
        }
        .athena-sidebar-btn.exit-btn:hover {
          background-color: rgba(239, 68, 68, 0.15) !important;
          background: rgba(239, 68, 68, 0.15) !important;
          color: #ef4444 !important;
        }
      `}</style>

      {/* Collapsible Left Sidebar (Matches Screenshot 1 & 2) */}
      <aside style={{ ...styles.sidebar, width: sidebarOpen ? '250px' : '70px' }}>
        {/* Sidebar Brand Header */}
        <div style={styles.sidebarHeader}>
          <div style={styles.blueShieldLogo}>🛡️</div>
          {sidebarOpen && (
            <div>
              <div style={styles.logoTitle}>ATHENA</div>
              <div style={styles.logoSubtitle}>Proctoring Admin</div>
            </div>
          )}
        </div>

        {/* Sidebar Navigation */}
        <div style={styles.navSectionHeader}>
          {sidebarOpen && <span>MAIN NAVIGATION</span>}
        </div>

        <nav style={styles.sidebarNav}>
          <button
            onClick={() => setActiveNav('dashboard')}
            className={`athena-sidebar-btn ${activeNav === 'dashboard' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'dashboard' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>🎛️</span>
            {sidebarOpen && <span>Dashboard</span>}
          </button>

          <button
            onClick={() => setActiveNav('live')}
            className={`athena-sidebar-btn ${activeNav === 'live' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'live' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>📹</span>
            {sidebarOpen && <span>Live Monitoring</span>}
            {sidebarOpen && <span style={styles.liveTag}>•• LIVE</span>}
          </button>

          <button
            onClick={() => setActiveNav('violations')}
            className={`athena-sidebar-btn ${activeNav === 'violations' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'violations' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>🛡️</span>
            {sidebarOpen && <span>Violations Center</span>}
          </button>

          <button
            onClick={() => setActiveNav('terminated')}
            className={`athena-sidebar-btn ${activeNav === 'terminated' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'terminated' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>✖️</span>
            {sidebarOpen && <span>Terminated Students</span>}
          </button>

          <button
            onClick={() => setActiveNav('finished')}
            className={`athena-sidebar-btn ${activeNav === 'finished' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'finished' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>✔️</span>
            {sidebarOpen && <span>Finished Exams</span>}
          </button>

          <button
            onClick={() => setActiveNav('history')}
            className={`athena-sidebar-btn ${activeNav === 'history' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'history' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>📜</span>
            {sidebarOpen && <span>Activity History</span>}
          </button>

          <button
            onClick={() => setActiveNav('reports')}
            className={`athena-sidebar-btn ${activeNav === 'reports' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'reports' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>📄</span>
            {sidebarOpen && <span>Reports</span>}
          </button>

          <button
            onClick={() => setActiveNav('analytics')}
            className={`athena-sidebar-btn ${activeNav === 'analytics' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'analytics' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>📊</span>
            {sidebarOpen && <span>Analytics</span>}
          </button>

          <button
            onClick={() => setActiveNav('settings')}
            className={`athena-sidebar-btn ${activeNav === 'settings' ? 'active' : ''}`}
            style={{ ...styles.navItem, ...(activeNav === 'settings' ? styles.navItemActive : { backgroundColor: 'transparent', color: '#94a3b8' }) }}
          >
            <span style={styles.navIcon}>⚙️</span>
            {sidebarOpen && <span>Settings</span>}
          </button>

          <button
            onClick={() => window.location.href = '/'}
            className="athena-sidebar-btn exit-btn"
            style={{ ...styles.navItem, marginTop: 'auto', color: '#f87171', backgroundColor: 'transparent' }}
          >
            <span style={styles.navIcon}>🚪</span>
            {sidebarOpen && <span>Exit Portal</span>}
          </button>
        </nav>

        {/* Bottom AI Engine Active Badge */}
        {sidebarOpen && (
          <div style={styles.aiEngineCard}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#34d399', fontWeight: 800, fontSize: '0.8rem' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }}></div>
              <span>AI Engine Active</span>
            </div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>
              FastAPI, OpenCV & YOLO Active
            </div>
          </div>
        )}
      </aside>

      {/* Main Content Pane */}
      <div style={styles.mainContent}>
        {/* Top Header Bar */}
        <header style={styles.topbar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button onClick={() => setSidebarOpen(!sidebarOpen)} style={styles.menuToggleBtn}>
              ≡
            </button>
            <div>
              <h1 style={styles.topbarTitle}>System Admin Command Center</h1>
              <p style={styles.topbarSubtitle}>Real-Time Proctoring & Anomaly Oversight</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            <a
              href="http://localhost:3001/live"
              target="_blank"
              rel="noreferrer"
              style={styles.externalLinkBtn}
            >
              🚀 Open Port 3001 Admin
            </a>

            {/* Theme Toggle */}
            <div style={styles.themeToggle} onClick={() => setDarkMode(!darkMode)}>
              <span style={{ fontSize: '0.85rem' }}>🌙</span>
              <div style={{
                width: '16px',
                height: '16px',
                borderRadius: '50%',
                backgroundColor: '#ffffff',
                transform: darkMode ? 'translateX(18px)' : 'translateX(0px)',
                transition: 'transform 0.2s ease'
              }}></div>
              <span style={{ fontSize: '0.85rem' }}>☀️</span>
            </div>

            {/* Notification Bell */}
            <div style={styles.iconBadgeBtn}>
              🔔
              <div style={styles.badgeDot}>2</div>
            </div>

            {/* Profile Avatar Pill */}
            <div style={styles.profilePill}>
              <div style={styles.adminAvatarCircle}>S</div>
              <div style={{ textTransform: 'none' }}>
                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: '#ffffff' }}>System Administrator</div>
                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>superadmin</div>
              </div>
            </div>
          </div>
        </header>

        {/* Notification Alert Banner */}
        {actionMessage && (
          <div style={styles.bannerAlert}>
            <span>{actionMessage}</span>
          </div>
        )}

        {/* -------------------------------------------------------------
            1. LIVE MONITORING VIEW (Matches screenshot 1 & default view)
           ------------------------------------------------------------- */}
        {activeNav === 'live' && (
          <div style={{ padding: '24px' }}>
            {/* Search & Filter Controls Bar */}
            <div style={styles.filterBar}>
              <div style={styles.searchWrapper}>
                <span style={{ marginLeft: '12px', color: '#94a3b8' }}>🔍</span>
                <input
                  type="text"
                  placeholder="Search by student name, USN, email, or exam..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={styles.searchInput}
                />
              </div>

              <select
                value={riskFilter}
                onChange={(e) => setRiskFilter(e.target.value)}
                style={styles.selectFilter}
              >
                <option value="ALL">All Risk Levels</option>
                <option value="SAFE">Safe (0-20)</option>
                <option value="MEDIUM">Medium Risk (20-50)</option>
                <option value="HIGH">High Risk (50+)</option>
              </select>

              <button onClick={fetchData} style={styles.refreshBtn}>
                🔄 Refresh Feed
              </button>
            </div>

            {/* Live Student Cards Grid / Empty State */}
            {filteredStudents.length === 0 ? (
              <div style={styles.emptyStateContainer}>
                <div style={styles.emptyStateIcon}>📡</div>
                <h3 style={styles.emptyStateTitle}>No Students Currently Online</h3>
                <p style={styles.emptyStateSubtitle}>
                  There are currently no students logged into an active exam. Live webcam feeds and AI proctoring telemetry cards will automatically appear here in real-time as examinees log in and begin their test session.
                </p>
                <button onClick={fetchData} style={styles.refreshBtn}>
                  🔄 Refresh Status
                </button>
              </div>
            ) : (
              <div style={styles.grid}>
              {filteredStudents.map((s, idx) => {
                const isTerminated = s.status === 'Terminated';
                const isWarning = s.status === 'Warning';

                const riskText = isTerminated ? 'High Risk (50+)' : (isWarning ? 'Medium (20-50)' : (s.riskLevel || 'Safe (0-20)'));
                const riskColor = isTerminated ? '#ef4444' : (isWarning ? '#f59e0b' : '#10b981');

                return (
                  <div key={s.sessionId || s.studentId || idx} style={styles.studentCard}>
                    {/* Card Header: Avatar + Student Name + USN + Risk Badge */}
                    <div style={styles.cardHeader}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={styles.avatarCircle}>
                          {s.studentName ? s.studentName.charAt(0).toUpperCase() : 'S'}
                        </div>
                        <div>
                          <h3 style={styles.studentNameTitle}>
                            {s.studentName}
                          </h3>
                          <div style={styles.studentUsnSub}>
                            USN: <strong>{s.usn}</strong> | {s.department}
                          </div>
                        </div>
                      </div>

                      <div style={{
                        padding: '4px 10px',
                        borderRadius: '20px',
                        fontSize: '0.725rem',
                        fontWeight: 800,
                        color: riskColor,
                        border: `1px solid ${riskColor}`,
                        background: `${riskColor}18`,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px'
                      }}>
                        <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: riskColor }}></div>
                        <span>{riskText}</span>
                      </div>
                    </div>

                    {/* Live Video Box */}
                    <div style={styles.videoBox}>
                      {s.image ? (
                        <img src={s.image} alt="Live Stream" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ textAlign: 'center', color: '#64748b' }}>
                          <div style={{ fontSize: '1.6rem', marginBottom: '4px' }}>📹</div>
                          <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#94a3b8' }}>
                            Webcam Standby
                          </div>
                        </div>
                      )}

                      {/* Online Live Badge Overlay */}
                      <div style={styles.onlineBadge}>
                        <div style={styles.pulsingDot}></div>
                        <span>{isTerminated ? 'TERMINATED' : (isWarning ? 'WARNING' : 'ONLINE LIVE')}</span>
                      </div>

                      {/* Watch Stream Button Overlay */}
                      <button
                        onClick={() => setWatchingStudent(s)}
                        style={styles.watchStreamBtn}
                      >
                        🎥 Watch Stream
                      </button>
                    </div>

                    {/* Exam Name & Start/Remaining Times */}
                    <div style={styles.examInfoHeader}>
                      <div style={styles.examNameLabel}>
                        EXAM: {s.examName || 'COMPUTER SCIENCE FINAL ASSESSMENT'}
                      </div>
                      <div style={styles.timeInfoRow}>
                        <span>🕒 Start: {s.startTime || '01:02 pm'}</span>
                        <span style={{ color: '#f59e0b', fontWeight: 700 }}>🕒 Rem: {s.remainingTime || '03:00:00'}</span>
                      </div>
                    </div>

                    {/* AI Proctor Telemetry Indicators Section */}
                    <div style={styles.cardBody}>
                      <div style={styles.telemetryTitle}>
                        AI Proctor Telemetry Indicators:
                      </div>

                      {/* 2x2 Telemetry Badge Pills */}
                      <div style={styles.pillGrid}>
                        <div style={{
                          ...styles.telemetryPill,
                          background: s.faceDetected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                          color: s.faceDetected ? '#10b981' : '#ef4444',
                          border: `1px solid ${s.faceDetected ? '#10b981' : '#ef4444'}`
                        }}>
                          {s.faceDetected ? '🟢 Face Detected' : '🔴 No Face'}
                        </div>

                        <div style={{
                          ...styles.telemetryPill,
                          background: !s.multipleFaces ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                          color: !s.multipleFaces ? '#10b981' : '#ef4444',
                          border: `1px solid ${!s.multipleFaces ? '#10b981' : '#ef4444'}`
                        }}>
                          {!s.multipleFaces ? '🟢 Single Face' : '🔴 Multiple Faces'}
                        </div>

                        <div style={{
                          ...styles.telemetryPill,
                          background: !s.mobilePhoneDetected ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)',
                          color: !s.mobilePhoneDetected ? '#10b981' : '#ef4444',
                          border: `1px solid ${!s.mobilePhoneDetected ? '#10b981' : '#ef4444'}`
                        }}>
                          {!s.mobilePhoneDetected ? '🟢 No Phone' : '📱 Phone Detected'}
                        </div>

                        <div style={{
                          ...styles.telemetryPill,
                          background: s.fullScreenStatus === 'Active' ? 'rgba(16, 185, 129, 0.12)' : 'rgba(245, 158, 11, 0.12)',
                          color: s.fullScreenStatus === 'Active' ? '#10b981' : '#f59e0b',
                          border: `1px solid ${s.fullScreenStatus === 'Active' ? '#10b981' : '#f59e0b'}`
                        }}>
                          {s.fullScreenStatus === 'Active' ? '🟢 Fullscreen Active' : '⚠️ Fullscreen Exited'}
                        </div>
                      </div>

                      {/* Head Pose & Eye Gaze Row */}
                      <div style={styles.poseBox}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span style={{ color: '#94a3b8' }}>Head Pose:</span>
                          <strong style={{ color: s.headPose?.includes('Looking') && !s.headPose?.includes('Center') ? '#f59e0b' : '#10b981' }}>
                            ✔ {s.headPose || 'Looking Center'}
                          </strong>
                        </div>

                        <div style={{ display: 'flex', gap: '6px' }}>
                          <span style={{ color: '#94a3b8' }}>Eye Gaze:</span>
                          <strong style={{ color: s.eyeGaze?.includes('Right') || s.eyeGaze?.includes('Off') ? '#f59e0b' : '#10b981' }}>
                            {s.eyeGaze?.includes('Right') || s.eyeGaze?.includes('Off') ? '⚠️ ' : '✔ '}{s.eyeGaze || 'Center'}
                          </strong>
                        </div>
                      </div>

                      {/* Tab Switches & Copy/Paste Counters */}
                      <div style={styles.countsRow}>
                        <span>Tab Switches: <strong>{s.tabSwitchingCount || 0}</strong></span>
                        <span>Copy/Paste: <strong>{s.copyPasteAttempts || 0}</strong></span>
                      </div>

                      {/* Action Buttons */}
                      <div style={styles.cardActions}>
                        <button
                          onClick={() => handleWarnStudent(s)}
                          disabled={isTerminated}
                          style={styles.warnBtn}
                        >
                          ⚠️ Warn Student
                        </button>

                        <button
                          onClick={() => handleOpenStudentDetail(s)}
                          style={styles.detailBtn}
                        >
                          ↗ View Detail
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            2. VIOLATIONS CENTER VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'violations' && (
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <h2 style={{ fontSize: '1.25rem', fontWeight: 800, margin: 0, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '10px' }}>
                🛡️ Violations Center Audit Log
              </h2>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                Showing {violations.length} logged violation incidents
              </span>
            </div>

            {violations.length === 0 ? (
              <div style={styles.emptyStateContainer}>
                <div style={styles.emptyStateIcon}>🛡️</div>
                <h3 style={styles.emptyStateTitle}>No Violation Incidents Logged</h3>
                <p style={styles.emptyStateSubtitle}>
                  All candidate sessions are currently adhering to proctoring guidelines. Any detected anomalies, phone usage, or rule breaches will be automatically captured and logged here in real-time.
                </p>
                <button onClick={fetchData} style={styles.refreshBtn}>
                  🔄 Refresh Audit Log
                </button>
              </div>
            ) : (
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      <th style={styles.tableTh}>Student Name & USN</th>
                      <th style={styles.tableTh}>Exam Name</th>
                      <th style={styles.tableTh}>Violation Type</th>
                      <th style={styles.tableTh}>Time</th>
                      <th style={styles.tableTh}>Severity</th>
                      <th style={styles.tableTh}>Screenshot Frame</th>
                      <th style={styles.tableTh}>Status</th>
                      <th style={styles.tableTh}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {violations.map((v, i) => {
                      const sevColor = v.severity === 'critical' || v.severity === 'high' ? '#ef4444' : '#f59e0b';
                      return (
                        <tr key={v.id || v._id || i} style={styles.tableRow}>
                          <td style={styles.tableTd}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={styles.miniAvatar}>
                                {v.studentName ? v.studentName.charAt(0).toUpperCase() : 'S'}
                              </div>
                              <div>
                                <div style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.9rem' }}>{v.studentName}</div>
                                <div style={{ fontSize: '0.725rem', color: '#94a3b8' }}>USN: {v.usn}</div>
                              </div>
                            </div>
                          </td>

                          <td style={styles.tableTd}>
                            <div style={{ fontWeight: 700, color: '#f8fafc', fontSize: '0.85rem' }}>{v.examName}</div>
                            <div style={{ fontSize: '0.725rem', color: '#64748b' }}>{v.department || 'Computer Science'}</div>
                          </td>

                          <td style={styles.tableTd}>
                            <div style={{ fontWeight: 800, color: v.severity === 'critical' ? '#ef4444' : (v.severity === 'high' ? '#f87171' : '#fbbf24'), fontSize: '0.85rem' }}>
                              {v.type || v.violationType}
                            </div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Conf: {v.confidence || '95%'}</div>
                          </td>

                          <td style={styles.tableTd}>
                            <div style={{ fontSize: '0.85rem', color: '#ffffff', fontWeight: 600 }}>{v.time || (v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : 'Recent')}</div>
                            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{v.date || (v.timestamp ? new Date(v.timestamp).toLocaleDateString() : '')}</div>
                          </td>

                          <td style={styles.tableTd}>
                            <span style={{
                              padding: '4px 12px',
                              borderRadius: '16px',
                              fontSize: '0.725rem',
                              fontWeight: 800,
                              color: '#ffffff',
                              backgroundColor: sevColor
                            }}>
                              {v.severity || 'medium'}
                            </span>
                          </td>

                          <td style={styles.tableTd}>
                            {v.screenshot || v.image ? (
                              <button
                                onClick={() => setEvidenceModalImage(v.screenshot || v.image)}
                                style={styles.iconCameraBtn}
                                title="View Screenshot Evidence Frame"
                              >
                                📷
                              </button>
                            ) : (
                              <span style={{ color: '#64748b', fontSize: '0.8rem' }}>N/A</span>
                            )}
                          </td>

                          <td style={styles.tableTd}>
                            <span style={styles.flaggedPill}>
                              {v.status || 'Flagged'}
                            </span>
                          </td>

                          <td style={styles.tableTd}>
                            <button
                              onClick={() => handleOpenStudentDetail(v)}
                              style={styles.actionLaunchBtn}
                              title="Inspect Full Student Detail"
                            >
                              ↗
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            3. STUDENT DETAIL VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'studentDetail' && selectedStudentDetail && (
          <div style={{ padding: '24px' }}>
            {/* Student Header Card */}
            <div style={styles.detailHeaderCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                      onClick={() => setActiveNav('live')}
                      style={{ background: 'none', border: '1px solid #334155', color: '#94a3b8', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem' }}
                    >
                      ← Back to Live
                    </button>
                    <h2 style={{ fontSize: '1.6rem', fontWeight: 900, color: '#ffffff', margin: 0 }}>
                      {selectedStudentDetail?.studentName || 'Examinee'}
                    </h2>
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '6px' }}>
                    USN: <strong>{selectedStudentDetail?.usn || 'N/A'}</strong> | Email: <strong>{selectedStudentDetail?.email || 'N/A'}</strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#818cf8', marginTop: '2px', fontWeight: 700 }}>
                    Department: {selectedStudentDetail?.department || 'General Science'}
                  </div>
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    Exam Name: <strong style={{ color: '#ffffff' }}>{selectedStudentDetail?.examName || 'Computer Science Final Assessment'}</strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '2px' }}>
                    Status: <strong style={{ color: selectedStudentDetail?.status === 'Terminated' ? '#ef4444' : '#34d399' }}>{selectedStudentDetail?.status || 'Online'}</strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: '#f59e0b', marginTop: '2px', fontWeight: 700 }}>
                    Suspicious Count: {violations.filter(v => (v.usn && selectedStudentDetail.usn && v.usn === selectedStudentDetail.usn) || (v.email && selectedStudentDetail.email && v.email === selectedStudentDetail.email)).length || selectedStudentDetail?.warningsCount || 0} Events
                  </div>
                </div>
              </div>
            </div>

            {/* Detail Content Grid: Video Bounding Box Frame (Left) + Timeline (Right) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '24px', marginTop: '24px' }}>
              {/* Left Column: Bounding Box Evidence Inspector */}
              <div style={styles.inspectorCard}>
                <div style={styles.inspectorVideoContainer}>
                  {selectedStudentDetail.image ? (
                    <div style={{ position: 'relative' }}>
                      <div style={styles.evidenceOverlayHeader}>
                        ● {selectedStudentDetail.status?.toUpperCase() || 'ONLINE'} • HEAD POSE: {selectedStudentDetail.headPose || 'Looking Center'}
                      </div>
                      <div style={styles.evidenceOverlayGaze}>
                        GAZE: {selectedStudentDetail.eyeGaze || 'Looking Center'}
                      </div>
                      <img
                        src={selectedStudentDetail.image}
                        alt="Live Student Frame"
                        style={{ width: '100%', height: '340px', objectFit: 'cover' }}
                      />
                      <div style={styles.confidenceOverlayBadge}>
                        Face Detection Confidence: <strong>{selectedStudentDetail.faceMatchConfidence || 98}% Match</strong>
                      </div>
                    </div>
                  ) : (
                    <div style={{ height: '340px', backgroundColor: '#020617', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
                      <div style={{ fontSize: '3rem', marginBottom: '8px' }}>📹</div>
                      <div style={{ color: '#ffffff', fontWeight: 800, fontSize: '1rem' }}>Webcam Standby</div>
                      <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>Awaiting live camera video feed from candidate</div>
                      <div style={styles.evidenceOverlayHeader}>
                        ● {selectedStudentDetail.status?.toUpperCase() || 'ONLINE'} • HEAD POSE: {selectedStudentDetail.headPose || 'Center'}
                      </div>
                      <div style={styles.confidenceOverlayBadge}>
                        Face Match Confidence: <strong>{selectedStudentDetail.faceMatchConfidence || 95}%</strong>
                      </div>
                    </div>
                  )}
                </div>

                <div style={{ padding: '16px' }}>
                  <h4 style={{ margin: '0 0 12px 0', fontSize: '0.9rem', color: '#ffffff', fontWeight: 800 }}>
                    Active Real-Time Telemetry Indicators
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                    <div style={styles.miniTelemetryCard}>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Face Verification</span>
                      <strong style={{ color: selectedStudentDetail.faceDetected ? '#34d399' : '#ef4444', fontSize: '0.85rem' }}>
                        {selectedStudentDetail.faceDetected ? `Verified (${selectedStudentDetail.faceMatchConfidence || 98}%)` : 'No Face'}
                      </strong>
                    </div>
                    <div style={styles.miniTelemetryCard}>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Multiple Faces</span>
                      <strong style={{ color: !selectedStudentDetail.multipleFaces ? '#34d399' : '#ef4444', fontSize: '0.85rem' }}>
                        {!selectedStudentDetail.multipleFaces ? 'Single Face' : 'Multiple Faces'}
                      </strong>
                    </div>
                    <div style={styles.miniTelemetryCard}>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Phone Status</span>
                      <strong style={{ color: !selectedStudentDetail.mobilePhoneDetected ? '#34d399' : '#ef4444', fontSize: '0.85rem' }}>
                        {!selectedStudentDetail.mobilePhoneDetected ? 'No Phone' : 'Phone Detected'}
                      </strong>
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Column: Complete Violation Timeline */}
              <div style={styles.timelineCard}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#ffffff', margin: '0 0 16px 0' }}>
                  Complete Violation Timeline
                </h3>

                {(() => {
                  const studentViolations = violations.filter(v =>
                    (v.usn && selectedStudentDetail.usn && v.usn === selectedStudentDetail.usn) ||
                    (v.email && selectedStudentDetail.email && v.email === selectedStudentDetail.email) ||
                    (v.studentId && selectedStudentDetail.studentId && v.studentId === selectedStudentDetail.studentId)
                  );

                  if (studentViolations.length === 0) {
                    return (
                      <div style={{ padding: '40px 16px', textAlign: 'center', backgroundColor: '#020617', borderRadius: '12px', border: '1px dashed #1e293b' }}>
                        <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>✅</div>
                        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#34d399' }}>Clean Integrity Record</div>
                        <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '6px' }}>
                          No cheating or anomaly violations recorded for this student session.
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      {studentViolations.map((v, i) => (
                        <div key={i} style={styles.timelineEventCard}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ fontSize: '0.9rem', color: '#ffffff' }}>{v.type || v.violationType}</strong>
                            <span style={v.severity === 'critical' ? styles.criticalPill : styles.highPill}>
                              {v.severity || 'warning'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginTop: '6px' }}>
                            {v.description || `${v.type || v.violationType} incident detected`}
                          </div>
                          <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '4px' }}>
                            Logged at: {v.time || (v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : 'Recent')}
                          </div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            4. DASHBOARD OVERVIEW VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'dashboard' && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 800, marginBottom: '16px', color: '#ffffff' }}>
              🎛️ Proctoring Overview & System KPI Summary
            </h2>

            <div style={styles.kpiGrid}>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Active Exams</div>
                <div style={styles.kpiValue}>{metrics.activeExams || 3}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Active Students</div>
                <div style={{ ...styles.kpiValue, color: '#38bdf8' }}>{students.length}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Violations Today</div>
                <div style={{ ...styles.kpiValue, color: '#fbbf24' }}>{metrics.violationsToday}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>High Risk Students</div>
                <div style={{ ...styles.kpiValue, color: '#f87171' }}>
                  {students.filter(s => s.riskLevel?.includes('High') || s.status === 'Terminated').length}
                </div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Exams Completed</div>
                <div style={{ ...styles.kpiValue, color: '#34d399' }}>{metrics.examsCompleted}</div>
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            5. TERMINATED STUDENTS VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'terminated' && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ef4444', marginBottom: '16px' }}>
              🔴 Terminated Student Sessions
            </h2>
            {terminatedStudents.length === 0 ? (
              <div style={styles.emptyStateContainer}>
                <div style={styles.emptyStateIcon}>🟢</div>
                <h3 style={styles.emptyStateTitle}>No Terminated Students</h3>
                <p style={styles.emptyStateSubtitle}>No student sessions have been terminated for cheating violations.</p>
              </div>
            ) : (
              <div style={styles.grid}>
                {terminatedStudents.map((s, i) => (
                  <div key={i} style={{ ...styles.studentCard, borderColor: '#ef4444' }}>
                    <div style={styles.cardHeader}>
                      <div>
                        <h3 style={{ margin: 0, color: '#ffffff', fontSize: '1rem' }}>{s.studentName}</h3>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>USN: {s.usn || s.studentId}</div>
                      </div>
                      <span style={styles.criticalPill}>TERMINATED</span>
                    </div>
                    <div style={{ padding: '14px', fontSize: '0.8rem', color: '#cbd5e1' }}>
                      <div>Reason: <strong>{s.terminationReason || 'Exceeded maximum violation limit'}</strong></div>
                      <div style={{ marginTop: '4px', color: '#94a3b8' }}>Terminated at: {s.terminationTime ? new Date(s.terminationTime).toLocaleTimeString() : 'Recent'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            6. FINISHED EXAMS VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'finished' && (
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#34d399', margin: 0 }}>
                ✔️ Finished & Passed Exam Sessions
              </h2>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                {finishedStudents.length} Completed Examinations
              </span>
            </div>

            {finishedStudents.length === 0 ? (
              <div style={styles.emptyStateContainer}>
                <div style={styles.emptyStateIcon}>✔️</div>
                <h3 style={styles.emptyStateTitle}>No Finished Exams Yet</h3>
                <p style={styles.emptyStateSubtitle}>Completed student exam submissions with proctoring score will be logged here.</p>
                <button onClick={fetchData} style={styles.refreshBtn}>
                  🔄 Refresh List
                </button>
              </div>
            ) : (
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      <th style={styles.tableTh}>Student Name & USN</th>
                      <th style={styles.tableTh}>Exam Name</th>
                      <th style={styles.tableTh}>Duration</th>
                      <th style={styles.tableTh}>Integrity Score</th>
                      <th style={styles.tableTh}>Status</th>
                      <th style={styles.tableTh}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finishedStudents.map((s, i) => (
                      <tr key={s._id || s.studentId || i} style={styles.tableRow}>
                        <td style={styles.tableTd}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={styles.miniAvatar}>
                              {s.studentName ? s.studentName.charAt(0).toUpperCase() : 'S'}
                            </div>
                            <div>
                              <div style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.9rem' }}>{s.studentName}</div>
                              <div style={{ fontSize: '0.725rem', color: '#94a3b8' }}>USN: {s.usn || s.studentId}</div>
                            </div>
                          </div>
                        </td>
                        <td style={styles.tableTd}>{s.examName || 'Computer Science Final Assessment'}</td>
                        <td style={styles.tableTd}>{s.duration || '00:45:00'}</td>
                        <td style={styles.tableTd}>
                          <strong style={{ color: '#34d399' }}>{s.integrityScore || (s.totalViolations > 0 ? (s.totalViolations > 2 ? '65% Review' : '85% Good') : '98% Safe')}</strong>
                        </td>
                        <td style={styles.tableTd}>
                          <span style={{ background: '#10b981', color: '#fff', padding: '3px 10px', borderRadius: '10px', fontSize: '0.725rem', fontWeight: 800 }}>
                            Completed
                          </span>
                        </td>
                        <td style={styles.tableTd}>
                          <button
                            onClick={() => handleOpenStudentDetail(s)}
                            style={styles.actionLaunchBtn}
                            title="Inspect Student Session Report"
                          >
                            ↗
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            7. REPORTS & ANALYTICS VIEW
           ------------------------------------------------------------- */}
        {(activeNav === 'reports' || activeNav === 'analytics') && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#818cf8', marginBottom: '16px' }}>
              📈 Reports & Anomaly Analytics Export
            </h2>
            <div style={{ display: 'flex', gap: '16px', marginBottom: '20px' }}>
              <button style={styles.actionLaunchBtn}>📄 Export Summary PDF Report</button>
              <button style={styles.actionLaunchBtn}>📊 Export Excel / CSV Audit Log</button>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            8. SETTINGS VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'settings' && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#ffffff', marginBottom: '16px' }}>
              ⚙️ AI Proctoring Engine Settings
            </h2>
            <div style={{ background: '#0f172a', padding: '20px', borderRadius: '12px', border: '1px solid #1e293b', maxWidth: '600px' }}>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#ffffff', fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>
                  Face Matching Tolerance Threshold (Current: 0.50)
                </label>
                <input type="range" min="0.30" max="0.70" step="0.05" defaultValue="0.50" style={{ width: '100%' }} />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <label style={{ display: 'block', color: '#ffffff', fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>
                  YOLO Object Detection Confidence Threshold (Current: 65%)
                </label>
                <input type="range" min="40" max="90" step="5" defaultValue="65" style={{ width: '100%' }} />
              </div>
            </div>
          </div>
        )}

        {/* Watch Stream Modal */}
        {watchingStudent && (
          <div style={styles.modalBackdrop}>
            <div style={styles.modalContent}>
              <div style={styles.modalHeader}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '1.2rem' }}>📹</span>
                  <div>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#ffffff', fontWeight: 800 }}>
                      LIVE CAMERA SENTINEL
                    </h3>
                    <div style={{ fontSize: '0.75rem', color: '#818cf8', fontWeight: 700 }}>
                      AI SENTINEL ACTIVE • {watchingStudent.studentName} ({watchingStudent.usn})
                    </div>
                  </div>
                </div>

                <button onClick={() => setWatchingStudent(null)} style={styles.modalCloseBtn}>
                  ✕
                </button>
              </div>

              <div style={styles.modalVideoBox}>
                {watchingStudent.image ? (
                  <img src={watchingStudent.image} alt="Live Stream" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                  <div style={{ textAlign: 'center', color: '#64748b' }}>
                    <div style={{ fontSize: '2rem', marginBottom: '8px' }}>📹</div>
                    <div style={{ fontSize: '0.9rem', color: '#ffffff', fontWeight: 700 }}>
                      Live Stream Connected
                    </div>
                  </div>
                )}

                <div style={styles.sentinelTag}>
                  <span>👤 {watchingStudent.studentName}</span>
                  <span style={{ color: '#34d399', marginLeft: '6px' }}>✓ Verified (98%)</span>
                </div>

                <div style={styles.modalLiveOverlay}>● LIVE</div>
                <div style={styles.modalFpsOverlay}>⚡ 15 FPS | 🧠 Confidence: 98%</div>
              </div>

              <div style={styles.audioMonitorBox}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <h4 style={{ margin: 0, fontSize: '0.9rem', color: '#38bdf8', fontWeight: 800 }}>
                    🎙️ AUDIO TELEMETRY MONITOR
                  </h4>
                  <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#34d399', background: 'rgba(52, 211, 153, 0.15)', padding: '2px 8px', borderRadius: '10px' }}>
                    Normal
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={styles.audioTelemetryItem}>
                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Mic Status</span>
                    <strong style={{ color: '#34d399', fontSize: '0.85rem' }}>● Active</strong>
                  </div>
                  <div style={styles.audioTelemetryItem}>
                    <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>Noise Level</span>
                    <strong style={{ color: '#38bdf8', fontSize: '0.85rem' }}>24 dB SPL</strong>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Evidence Image Modal */}
        {evidenceModalImage && (
          <div style={styles.modalBackdrop} onClick={() => setEvidenceModalImage(null)}>
            <div style={{ ...styles.modalContent, maxWidth: '600px', padding: '20px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
              <h3 style={{ color: '#ffffff', margin: '0 0 14px 0' }}>📷 Violation Evidence Screenshot Frame</h3>
              <div style={{ borderRadius: '12px', overflow: 'hidden', border: '1px solid #ef4444' }}>
                <img
                  src={evidenceModalImage === 'sample' ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80' : evidenceModalImage}
                  alt="Evidence"
                  style={{ width: '100%', maxHeight: '350px', objectFit: 'cover' }}
                />
              </div>
              <button onClick={() => setEvidenceModalImage(null)} style={{ marginTop: '16px', padding: '8px 20px', backgroundColor: '#334155', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 700 }}>
                Close Preview
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


const styles = {
  appWrapper: {
    display: 'flex',
    minHeight: '100vh',
    backgroundColor: '#0b0f19',
    color: '#f8fafc',
    fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
  },
  sidebar: {
    backgroundColor: '#0f172a',
    borderRight: '1px solid #1e293b',
    display: 'flex',
    flexDirection: 'column',
    transition: 'width 0.2s ease',
    overflow: 'hidden'
  },
  sidebarHeader: {
    height: '64px',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: '12px',
    borderBottom: '1px solid #1e293b'
  },
  blueShieldLogo: {
    fontSize: '1.5rem'
  },
  logoTitle: {
    fontSize: '1rem',
    fontWeight: '900',
    color: '#ffffff',
    letterSpacing: '0.05em'
  },
  logoSubtitle: {
    fontSize: '0.675rem',
    color: '#94a3b8',
    fontWeight: '600'
  },
  navSectionHeader: {
    padding: '16px 16px 6px 16px',
    fontSize: '0.65rem',
    fontWeight: '800',
    color: '#64748b',
    letterSpacing: '0.08em'
  },
  sidebarNav: {
    display: 'flex',
    flexDirection: 'column',
    padding: '8px 12px',
    gap: '4px',
    flexGrow: 1
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '10px 12px',
    borderRadius: '10px',
    background: 'transparent',
    backgroundColor: 'transparent',
    border: 'none',
    outline: 'none',
    boxShadow: 'none',
    color: '#94a3b8',
    fontSize: '0.85rem',
    fontWeight: '600',
    cursor: 'pointer',
    textAlign: 'left',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s ease'
  },
  navItemActive: {
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    background: 'rgba(99, 102, 241, 0.15)',
    color: '#818cf8',
    borderLeft: '3px solid #6366f1',
    fontWeight: '800'
  },
  navIcon: {
    fontSize: '1.05rem'
  },
  liveTag: {
    marginLeft: 'auto',
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    color: '#ef4444',
    padding: '2px 6px',
    borderRadius: '10px',
    fontSize: '0.65rem',
    fontWeight: '800'
  },
  aiEngineCard: {
    margin: '12px',
    padding: '12px',
    backgroundColor: '#020617',
    borderRadius: '10px',
    border: '1px solid #1e293b'
  },
  mainContent: {
    flexGrow: 1,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0
  },
  topbar: {
    height: '64px',
    backgroundColor: '#0f172a',
    borderBottom: '1px solid #1e293b',
    padding: '0 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between'
  },
  menuToggleBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: '1.4rem',
    cursor: 'pointer',
    padding: '4px'
  },
  topbarTitle: {
    margin: 0,
    fontSize: '1.1rem',
    fontWeight: '800',
    color: '#ffffff'
  },
  topbarSubtitle: {
    margin: 0,
    fontSize: '0.75rem',
    color: '#94a3b8'
  },
  externalLinkBtn: {
    padding: '6px 12px',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    border: '1px solid #6366f1',
    color: '#818cf8',
    borderRadius: '8px',
    fontSize: '0.775rem',
    fontWeight: '700',
    textDecoration: 'none'
  },
  themeToggle: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 8px',
    backgroundColor: '#1e293b',
    borderRadius: '20px',
    cursor: 'pointer'
  },
  iconBadgeBtn: {
    position: 'relative',
    fontSize: '1.1rem',
    cursor: 'pointer',
    padding: '6px'
  },
  badgeDot: {
    position: 'absolute',
    top: '2px',
    right: '2px',
    width: '14px',
    height: '14px',
    borderRadius: '50%',
    backgroundColor: '#ef4444',
    color: '#fff',
    fontSize: '0.65rem',
    fontWeight: '800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  profilePill: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    backgroundColor: '#1e293b',
    padding: '4px 12px 4px 6px',
    borderRadius: '24px'
  },
  adminAvatarCircle: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #a855f7)',
    color: '#ffffff',
    fontWeight: '800',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.85rem'
  },
  bannerAlert: {
    margin: '16px 24px 0 24px',
    padding: '10px 16px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid #6366f1',
    borderRadius: '10px',
    color: '#a5b4fc',
    fontSize: '0.85rem',
    fontWeight: '700'
  },
  kpiGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: '16px',
    marginBottom: '24px'
  },
  kpiCard: {
    padding: '16px',
    backgroundColor: '#0f172a',
    borderRadius: '12px',
    border: '1px solid #1e293b'
  },
  kpiLabel: {
    fontSize: '0.8rem',
    color: '#94a3b8',
    marginBottom: '4px',
    fontWeight: '600'
  },
  kpiValue: {
    fontSize: '1.6rem',
    fontWeight: '800'
  },
  filterBar: {
    display: 'flex',
    gap: '14px',
    marginBottom: '24px',
    alignItems: 'center'
  },
  searchWrapper: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: '10px'
  },
  searchInput: {
    flex: 1,
    padding: '10px 14px',
    background: 'none',
    border: 'none',
    color: '#ffffff',
    fontSize: '0.875rem',
    outline: 'none'
  },
  selectFilter: {
    padding: '10px 14px',
    borderRadius: '10px',
    backgroundColor: '#0f172a',
    border: '1px solid #1e293b',
    color: '#ffffff',
    fontSize: '0.875rem',
    outline: 'none'
  },
  refreshBtn: {
    padding: '10px 16px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#ffffff',
    borderRadius: '10px',
    fontWeight: '600',
    cursor: 'pointer'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
    gap: '20px'
  },
  studentCard: {
    backgroundColor: '#0f172a',
    borderRadius: '16px',
    border: '1px solid #1e293b',
    overflow: 'hidden'
  },
  cardHeader: {
    padding: '14px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottom: '1px solid #1e293b'
  },
  avatarCircle: {
    width: '38px',
    height: '38px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '800',
    fontSize: '0.95rem',
    color: '#ffffff'
  },
  studentNameTitle: {
    fontSize: '0.95rem',
    fontWeight: '800',
    margin: 0,
    color: '#ffffff'
  },
  studentUsnSub: {
    fontSize: '0.725rem',
    color: '#94a3b8',
    marginTop: '2px'
  },
  videoBox: {
    height: '160px',
    backgroundColor: '#020617',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden'
  },
  onlineBadge: {
    position: 'absolute',
    top: '10px',
    left: '10px',
    background: 'rgba(16, 185, 129, 0.9)',
    color: '#ffffff',
    padding: '3px 10px',
    borderRadius: '20px',
    fontSize: '0.7rem',
    fontWeight: '800',
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)'
  },
  pulsingDot: {
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    backgroundColor: '#ffffff'
  },
  watchStreamBtn: {
    position: 'absolute',
    bottom: '10px',
    right: '10px',
    padding: '6px 12px',
    backgroundColor: 'rgba(99, 102, 241, 0.85)',
    color: '#ffffff',
    border: 'none',
    borderRadius: '6px',
    fontSize: '0.725rem',
    fontWeight: '700',
    cursor: 'pointer',
    backdropFilter: 'blur(4px)'
  },
  examInfoHeader: {
    padding: '10px 14px',
    backgroundColor: '#020617',
    borderBottom: '1px solid #1e293b'
  },
  examNameLabel: {
    fontSize: '0.7rem',
    fontWeight: '800',
    color: '#818cf8',
    letterSpacing: '0.04em'
  },
  timeInfoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.725rem',
    color: '#cbd5e1',
    marginTop: '4px'
  },
  cardBody: {
    padding: '14px'
  },
  telemetryTitle: {
    fontSize: '0.725rem',
    fontWeight: '700',
    color: '#94a3b8',
    marginBottom: '8px'
  },
  pillGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '6px',
    marginBottom: '12px'
  },
  telemetryPill: {
    padding: '5px 8px',
    borderRadius: '6px',
    fontSize: '0.7rem',
    fontWeight: '700',
    textAlign: 'center'
  },
  poseBox: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.725rem',
    padding: '8px 10px',
    backgroundColor: '#020617',
    borderRadius: '8px',
    marginBottom: '10px'
  },
  countsRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.725rem',
    color: '#94a3b8',
    marginBottom: '12px'
  },
  cardActions: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: '8px'
  },
  warnBtn: {
    padding: '8px',
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    border: '1px solid #f59e0b',
    color: '#fbbf24',
    borderRadius: '8px',
    fontWeight: '700',
    fontSize: '0.75rem',
    cursor: 'pointer'
  },
  detailBtn: {
    padding: '8px',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    border: '1px solid #6366f1',
    color: '#818cf8',
    borderRadius: '8px',
    fontWeight: '700',
    fontSize: '0.75rem',
    cursor: 'pointer'
  },
  tableCard: {
    backgroundColor: '#0f172a',
    borderRadius: '16px',
    border: '1px solid #1e293b',
    overflow: 'hidden'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    textAlign: 'left'
  },
  tableHeaderRow: {
    backgroundColor: '#020617',
    borderBottom: '1px solid #1e293b'
  },
  tableTh: {
    padding: '14px 16px',
    fontSize: '0.75rem',
    fontWeight: '800',
    color: '#94a3b8',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
  },
  tableRow: {
    borderBottom: '1px solid #1e293b'
  },
  tableTd: {
    padding: '14px 16px',
    fontSize: '0.85rem'
  },
  miniAvatar: {
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontWeight: '800',
    color: '#ffffff',
    fontSize: '0.85rem'
  },
  iconCameraBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.2rem',
    cursor: 'pointer'
  },
  flaggedPill: {
    padding: '4px 10px',
    borderRadius: '12px',
    backgroundColor: '#1e293b',
    color: '#cbd5e1',
    fontSize: '0.725rem',
    fontWeight: '700'
  },
  actionLaunchBtn: {
    padding: '6px 10px',
    backgroundColor: 'rgba(99, 102, 241, 0.2)',
    border: '1px solid #6366f1',
    color: '#818cf8',
    borderRadius: '6px',
    fontSize: '0.85rem',
    fontWeight: '800',
    cursor: 'pointer'
  },
  detailHeaderCard: {
    backgroundColor: '#0f172a',
    borderRadius: '16px',
    border: '1px solid #1e293b',
    padding: '24px'
  },
  inspectorCard: {
    backgroundColor: '#0f172a',
    borderRadius: '16px',
    border: '1px solid #1e293b',
    overflow: 'hidden'
  },
  inspectorVideoContainer: {
    position: 'relative',
    backgroundColor: '#000000'
  },
  evidenceOverlayHeader: {
    position: 'absolute',
    top: '10px',
    left: '10px',
    backgroundColor: 'rgba(16, 185, 129, 0.9)',
    color: '#ffffff',
    padding: '4px 12px',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '800',
    zIndex: 2
  },
  evidenceOverlayGaze: {
    position: 'absolute',
    top: '40px',
    left: '10px',
    backgroundColor: 'rgba(16, 185, 129, 0.85)',
    color: '#ffffff',
    padding: '4px 12px',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '800',
    zIndex: 2
  },
  confidenceOverlayBadge: {
    position: 'absolute',
    bottom: '10px',
    left: '10px',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    border: '1px solid #34d399',
    color: '#ffffff',
    padding: '6px 12px',
    borderRadius: '8px',
    fontSize: '0.75rem',
    zIndex: 2
  },
  miniTelemetryCard: {
    backgroundColor: '#020617',
    padding: '10px',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  timelineCard: {
    backgroundColor: '#0f172a',
    borderRadius: '16px',
    border: '1px solid #1e293b',
    padding: '24px'
  },
  timelineEventCard: {
    backgroundColor: '#020617',
    border: '1px solid #1e293b',
    borderRadius: '12px',
    padding: '14px'
  },
  criticalPill: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    color: '#ef4444',
    border: '1px solid #ef4444',
    padding: '2px 8px',
    borderRadius: '8px',
    fontSize: '0.675rem',
    fontWeight: '800'
  },
  highPill: {
    backgroundColor: 'rgba(245, 158, 11, 0.2)',
    color: '#f59e0b',
    border: '1px solid #f59e0b',
    padding: '2px 8px',
    borderRadius: '8px',
    fontSize: '0.675rem',
    fontWeight: '800'
  },
  modalBackdrop: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.85)',
    backdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    padding: '20px'
  },
  modalContent: {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '16px',
    width: '100%',
    maxWidth: '680px',
    overflow: 'hidden',
    boxShadow: '0 20px 40px rgba(0,0,0,0.6)'
  },
  modalHeader: {
    padding: '16px 20px',
    backgroundColor: '#020617',
    borderBottom: '1px solid #1e293b',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  modalCloseBtn: {
    background: 'none',
    border: 'none',
    color: '#94a3b8',
    fontSize: '1.2rem',
    cursor: 'pointer'
  },
  modalVideoBox: {
    height: '320px',
    backgroundColor: '#000000',
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center'
  },
  sentinelTag: {
    position: 'absolute',
    top: '14px',
    left: '14px',
    padding: '6px 12px',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    border: '1px solid #34d399',
    borderRadius: '20px',
    fontSize: '0.8rem',
    fontWeight: '800',
    color: '#ffffff',
    backdropFilter: 'blur(6px)'
  },
  modalLiveOverlay: {
    position: 'absolute',
    top: '14px',
    right: '14px',
    padding: '4px 10px',
    backgroundColor: '#ef4444',
    color: '#ffffff',
    borderRadius: '12px',
    fontSize: '0.7rem',
    fontWeight: '800'
  },
  modalFpsOverlay: {
    position: 'absolute',
    bottom: '14px',
    left: '14px',
    padding: '4px 10px',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    color: '#38bdf8',
    borderRadius: '8px',
    fontSize: '0.725rem',
    fontWeight: '700'
  },
  audioMonitorBox: {
    padding: '16px 20px',
    backgroundColor: '#020617',
    borderTop: '1px solid #1e293b'
  },
  audioTelemetryItem: {
    backgroundColor: '#0f172a',
    padding: '8px 12px',
    borderRadius: '8px',
    display: 'flex',
    flexDirection: 'column',
    gap: '2px'
  },
  emptyStateContainer: {
    backgroundColor: '#0f172a',
    borderRadius: '16px',
    border: '1px dashed #334155',
    padding: '60px 24px',
    textAlign: 'center',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: '20px'
  },
  emptyStateIcon: {
    fontSize: '3.2rem',
    marginBottom: '14px',
    color: '#818cf8'
  },
  emptyStateTitle: {
    fontSize: '1.25rem',
    fontWeight: '800',
    color: '#ffffff',
    margin: '0 0 8px 0'
  },
  emptyStateSubtitle: {
    fontSize: '0.875rem',
    color: '#94a3b8',
    maxWidth: '480px',
    lineHeight: '1.6',
    margin: '0 0 20px 0'
  }
};
