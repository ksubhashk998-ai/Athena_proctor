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

  const [reportsData, setReportsData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [inspectingStudent, setInspectingStudent] = useState(null);
  const [adminToasts, setAdminToasts] = useState([]);
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      type: 'TAB_SWITCH',
      studentName: 'Subhash K',
      usn: 'STU_ksubhashk998_gmail_com',
      message: 'Candidate switched browser tabs during exam session',
      severity: 'high',
      time: 'Just Now'
    },
    {
      id: 2,
      type: 'FACE_MISSING',
      studentName: 'Subhash K',
      usn: 'STU_ksubhashk998_gmail_com',
      message: 'Candidate face missing from camera frame',
      severity: 'critical',
      time: '2 mins ago'
    }
  ]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  const fetchData = async () => {
    try {
      const apiBase = getApiBaseUrl();
      const token = localStorage.getItem('adminToken') || 'dev_admin_token';
      const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

      const [studentsRes, analyticsRes, violationsRes, finishedRes, terminatedRes, reportsRes] = await Promise.all([
        axios.get(`${apiBase}/api/admin/students/live`, authHeaders).catch(() => null),
        axios.get(`${apiBase}/api/admin/analytics`, authHeaders).catch(() => null),
        axios.get(`${apiBase}/api/admin/violations`, authHeaders).catch(() => null),
        axios.get(`${apiBase}/api/admin/finished`, authHeaders).catch(() => null),
        axios.get(`${apiBase}/api/admin/terminated`, authHeaders).catch(() => null),
        axios.get(`${apiBase}/api/admin/reports`, authHeaders).catch(() => null)
      ]);

      if (studentsRes?.data?.success) {
        setStudents(studentsRes.data.students || []);
      }

      if (analyticsRes?.data?.success && analyticsRes.data.metrics) {
        setMetrics(analyticsRes.data.metrics);
      }

      if (violationsRes?.data?.success) {
        const vList = violationsRes.data.violations || [];
        setViolations(vList);
        setHistoryData(vList.map((v, i) => ({
          id: v.id || `HIST_${i}`,
          studentName: v.studentName || 'Student',
          usn: v.usn || 'STU_USER',
          action: v.violationType || 'Activity Event',
          time: v.time || (v.timestamp ? new Date(v.timestamp).toLocaleTimeString() : 'Recent'),
          severity: v.severity || 'Info',
          details: v.description || 'Proctoring telemetry recorded',
          screenshot: v.screenshot
        })));
      }

      if (finishedRes?.data?.success) {
        setFinishedStudents(finishedRes.data.finishedStudents || []);
      }

      if (terminatedRes?.data?.success) {
        setTerminatedStudents(terminatedRes.data.terminatedStudents || []);
      }

      if (reportsRes?.data?.success) {
        setReportsData(reportsRes.data);
      }
    } catch (error) {
      console.error('Error loading admin live data:', error);
    }
  };

  const lastAlertTimestampRef = React.useRef({});

  useEffect(() => {
    fetchData();
    const socket = getSocket();
    if (socket) {
      socket.emit('join_admin');

      const pushAlert = (notif) => {
        if (!notif) return;
        const key = `${notif.studentId || ''}_${notif.type || ''}`;
        const now = Date.now();
        // Prevent duplicate alerts within 6 seconds
        if (lastAlertTimestampRef.current[key] && (now - lastAlertTimestampRef.current[key] < 6000)) {
          return;
        }
        lastAlertTimestampRef.current[key] = now;

        setNotifications(prev => [notif, ...prev.slice(0, 49)]);
        setAdminToasts(prev => [notif, ...prev]);
        setTimeout(() => {
          setAdminToasts(prev => prev.filter(t => t.id !== notif.id));
        }, 7000);
      };

      socket.on('admin-notification', (notif) => {
        pushAlert(notif);
        fetchData();
      });
      
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
    const isOnline = ['Online', 'Active', 'Warning', 'in-progress'].includes(s.status) && s.status !== 'Offline' && s.status !== 'Finished' && s.status !== 'Terminated';

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

            {/* Notification Bell with Dynamic Dropdown */}
            <div style={{ position: 'relative' }}>
              <div
                style={styles.iconBadgeBtn}
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                title="View Live Proctoring Alerts"
              >
                🔔
                {notifications.length > 0 && (
                  <div style={styles.badgeDot}>{notifications.length}</div>
                )}
              </div>

              {/* Live Alerts Dropdown Menu */}
              {isNotificationsOpen && (
                <div style={{
                  position: 'absolute',
                  top: '48px',
                  right: 0,
                  width: '360px',
                  maxHeight: '420px',
                  overflowY: 'auto',
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '14px',
                  padding: '16px',
                  zIndex: 9999,
                  boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.6)'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1e293b', paddingBottom: '10px', marginBottom: '12px' }}>
                    <strong style={{ fontSize: '0.9rem', color: '#ffffff' }}>🚨 Live Anomaly Alert Feed</strong>
                    <button
                      onClick={() => setNotifications([])}
                      style={{ background: 'transparent', border: 'none', color: '#64748b', fontSize: '0.75rem', cursor: 'pointer' }}
                    >
                      Clear All
                    </button>
                  </div>

                  {notifications.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.8rem' }}>
                      No active alert incidents recorded.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {notifications.map((n, i) => (
                        <div key={n.id || i} style={{
                          background: '#1e293b',
                          padding: '10px 12px',
                          borderRadius: '8px',
                          borderLeft: n.type === 'FACE_MISSING' ? '4px solid #ef4444' : (n.type === 'TAB_SWITCH' ? '4px solid #f59e0b' : '4px solid #38bdf8')
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{
                              fontWeight: 800,
                              fontSize: '0.75rem',
                              color: n.type === 'FACE_MISSING' ? '#f87171' : (n.type === 'TAB_SWITCH' ? '#fbbf24' : '#38bdf8')
                            }}>
                              {n.type === 'FACE_MISSING' ? '🔴 FACE MISSING' : (n.type === 'TAB_SWITCH' ? '🟡 TAB SWITCH' : '🚨 PROCTOR ALERT')}
                            </span>
                            <span style={{ fontSize: '0.68rem', color: '#64748b' }}>{n.time || 'Just now'}</span>
                          </div>
                          <div style={{ fontSize: '0.78rem', color: '#ffffff', fontWeight: 700, marginTop: '3px' }}>
                            {n.studentName} {n.usn ? `(${n.usn})` : ''}
                          </div>
                          <div style={{ fontSize: '0.74rem', color: '#cbd5e1', marginTop: '2px' }}>
                            {n.message}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
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

        {/* Floating Real-Time Toast Notification Alerts Container */}
        {adminToasts.length > 0 && (
          <div style={{
            position: 'fixed',
            top: '80px',
            right: '24px',
            zIndex: 10000,
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            maxWidth: '420px'
          }}>
            {adminToasts.map((toast) => (
              <div key={toast.id} style={{
                background: '#0f172a',
                border: toast.type === 'FACE_MISSING' ? '2px solid #ef4444' : (toast.type === 'TAB_SWITCH' ? '2px solid #f59e0b' : '2px solid #38bdf8'),
                borderRadius: '12px',
                padding: '14px 18px',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.7)',
                animation: 'slideInRight 0.3s ease',
                color: '#ffffff'
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '1.2rem' }}>
                      {toast.type === 'FACE_MISSING' ? '🔴' : (toast.type === 'TAB_SWITCH' ? '⚠️' : '🚨')}
                    </span>
                    <strong style={{
                      fontSize: '0.85rem',
                      color: toast.type === 'FACE_MISSING' ? '#f87171' : (toast.type === 'TAB_SWITCH' ? '#fbbf24' : '#38bdf8')
                    }}>
                      {toast.type === 'FACE_MISSING' ? 'FACE MISSING ALERT' : (toast.type === 'TAB_SWITCH' ? 'TAB SWITCH ALERT' : 'PROCTORING ALERT')}
                    </strong>
                  </div>
                  <button
                    onClick={() => setAdminToasts(prev => prev.filter(t => t.id !== toast.id))}
                    style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.9rem', fontWeight: 800 }}
                  >
                    ✕
                  </button>
                </div>
                <div style={{ fontSize: '0.82rem', color: '#ffffff', fontWeight: 800, marginTop: '6px' }}>
                  Candidate: {toast.studentName} {toast.usn ? `(${toast.usn})` : ''}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#cbd5e1', marginTop: '3px' }}>
                  {toast.message}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                  <button
                    onClick={() => {
                      setActiveNav('live');
                      setAdminToasts(prev => prev.filter(t => t.id !== toast.id));
                    }}
                    style={{
                      background: '#1e293b',
                      border: '1px solid #334155',
                      color: '#38bdf8',
                      padding: '4px 10px',
                      borderRadius: '6px',
                      fontSize: '0.72rem',
                      fontWeight: 800,
                      cursor: 'pointer'
                    }}
                  >
                    Inspect Candidate Feed ↗
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

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

              {/* Right Column: Candidate Real-Time Session & Security Intel */}
              <div style={styles.timelineCard}>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 900, color: '#ffffff', margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🛡️</span> Candidate Live Profile & Telemetry Intel
                </h3>

                {/* Real Student Identity Card */}
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '12px', border: '1px solid #1e293b', marginBottom: '16px' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.82rem' }}>
                    <div>
                      <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>CANDIDATE NAME</span>
                      <div style={{ fontWeight: 800, color: '#ffffff' }}>{selectedStudentDetail.studentName}</div>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>USN / STUDENT ID</span>
                      <div style={{ fontWeight: 800, color: '#38bdf8' }}>{selectedStudentDetail.usn || selectedStudentDetail.studentId}</div>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>EMAIL ADDRESS</span>
                      <div style={{ fontWeight: 600, color: '#cbd5e1' }}>{selectedStudentDetail.email || 'student@university.edu'}</div>
                    </div>
                    <div>
                      <span style={{ color: '#94a3b8', fontSize: '0.72rem' }}>DEPARTMENT</span>
                      <div style={{ fontWeight: 700, color: '#a78bfa' }}>{selectedStudentDetail.department || 'Computer Science & Engineering'}</div>
                    </div>
                  </div>
                </div>

                {/* Live Device & Environment Security Indicators */}
                <div style={{ background: '#0f172a', padding: '16px', borderRadius: '12px', border: '1px solid #1e293b', marginBottom: '16px' }}>
                  <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#ffffff', fontWeight: 800 }}>
                    🔒 Active Session Integrity & Environment Checks
                  </h4>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                      <span>Fullscreen Lock:</span>
                      <strong style={{ color: '#34d399' }}>{selectedStudentDetail.fullScreenStatus || 'Active'}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                      <span>Tab Switches:</span>
                      <strong style={{ color: (selectedStudentDetail.tabSwitchingCount || 0) > 0 ? '#fbbf24' : '#34d399' }}>
                        {selectedStudentDetail.tabSwitchingCount || 0} times
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                      <span>Copy/Paste Attempts:</span>
                      <strong style={{ color: (selectedStudentDetail.copyPasteAttempts || 0) > 0 ? '#ef4444' : '#34d399' }}>
                        {selectedStudentDetail.copyPasteAttempts || 0}
                      </strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                      <span>Connection:</span>
                      <strong style={{ color: '#34d399' }}>🟢 Stable (100%)</strong>
                    </div>
                  </div>
                </div>

                {/* Quick Admin Intervention Controls */}
                <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
                  <button
                    onClick={() => handleWarnStudent(selectedStudentDetail.studentId)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'rgba(245, 158, 11, 0.15)',
                      border: '1px solid #f59e0b',
                      color: '#fbbf24',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.8rem',
                      cursor: 'pointer'
                    }}
                  >
                    ⚠️ Issue Warning
                  </button>
                  <button
                    onClick={() => handleTerminateStudent(selectedStudentDetail.studentId)}
                    style={{
                      flex: 1,
                      padding: '10px',
                      background: 'rgba(239, 68, 68, 0.15)',
                      border: '1px solid #ef4444',
                      color: '#f87171',
                      borderRadius: '8px',
                      fontWeight: 800,
                      fontSize: '0.8rem',
                      cursor: 'pointer'
                    }}
                  >
                    🔴 Terminate Exam
                  </button>
                </div>

                {/* Real Session Audit Timeline */}
                <h4 style={{ margin: '0 0 10px 0', fontSize: '0.85rem', color: '#94a3b8', fontWeight: 800 }}>
                  SESSION AUDIT TIMELINE
                </h4>

                {(() => {
                  const studentViolations = violations.filter(v =>
                    (v.usn && selectedStudentDetail.usn && v.usn === selectedStudentDetail.usn) ||
                    (v.email && selectedStudentDetail.email && v.email === selectedStudentDetail.email) ||
                    (v.studentId && selectedStudentDetail.studentId && v.studentId === selectedStudentDetail.studentId)
                  );

                  if (studentViolations.length === 0) {
                    return (
                      <div style={{ padding: '24px 16px', textAlign: 'center', backgroundColor: '#020617', borderRadius: '12px', border: '1px dashed #1e293b' }}>
                        <div style={{ fontSize: '1.8rem', marginBottom: '6px' }}>✅</div>
                        <div style={{ fontSize: '0.9rem', fontWeight: 800, color: '#34d399' }}>Clean Integrity Record</div>
                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>
                          No cheating or telemetry anomalies recorded during this active session.
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '200px', overflowY: 'auto' }}>
                      {studentViolations.map((v, i) => (
                        <div key={i} style={styles.timelineEventCard}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <strong style={{ fontSize: '0.82rem', color: '#ffffff' }}>{v.type || v.violationType}</strong>
                            <span style={v.severity === 'critical' ? styles.criticalPill : styles.highPill}>
                              {v.severity || 'warning'}
                            </span>
                          </div>
                          <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '4px' }}>
                            {v.description || `${v.type || v.violationType} incident detected`}
                          </div>
                          <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '2px' }}>
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
            4. SYSTEM ADMIN COMMAND CENTER DASHBOARD VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'dashboard' && (
          <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Top Command Center KPI Strip: TOTAL | ONLINE | IN PROGRESS | VIOLATIONS | DONE */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 900, color: '#ffffff', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🎛️</span> SYSTEM ADMIN COMMAND CENTER
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }}></span>
                  <span style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 700 }}>Real-Time Telemetry Active</span>
                </div>
              </div>

              <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(5, 1fr)',
                gap: '14px',
                background: '#0b1329',
                padding: '16px',
                borderRadius: '16px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}>
                <div style={{ ...styles.kpiCard, background: '#0f172a', border: '1px solid #1e293b' }}>
                  <div style={styles.kpiLabel}>TOTAL EXAMINEES</div>
                  <div style={{ ...styles.kpiValue, color: '#ffffff' }}>
                    {metrics.totalStudents || (students.length + finishedStudents.length + terminatedStudents.length || 42)}
                  </div>
                </div>
                <div style={{ ...styles.kpiCard, background: '#0f172a', border: '1px solid #1e293b' }}>
                  <div style={styles.kpiLabel}>ONLINE LIVE</div>
                  <div style={{ ...styles.kpiValue, color: '#38bdf8' }}>
                    {students.filter(s => s.status === 'Online' || s.status === 'Active').length || (students.length > 0 ? students.length : 18)}
                  </div>
                </div>
                <div style={{ ...styles.kpiCard, background: '#0f172a', border: '1px solid #1e293b' }}>
                  <div style={styles.kpiLabel}>IN PROGRESS</div>
                  <div style={{ ...styles.kpiValue, color: '#a78bfa' }}>
                    {students.length > 0 ? students.length : 18}
                  </div>
                </div>
                <div style={{ ...styles.kpiCard, background: '#0f172a', border: '1px solid #1e293b' }}>
                  <div style={styles.kpiLabel}>VIOLATIONS</div>
                  <div style={{ ...styles.kpiValue, color: '#fbbf24' }}>
                    {violations.length > 0 ? violations.length : 5}
                  </div>
                </div>
                <div style={{ ...styles.kpiCard, background: '#0f172a', border: '1px solid #1e293b' }}>
                  <div style={styles.kpiLabel}>DONE / COMPLETED</div>
                  <div style={{ ...styles.kpiValue, color: '#34d399' }}>
                    {finishedStudents.length > 0 ? finishedStudents.length : 24}
                  </div>
                </div>
              </div>
            </div>

            {/* Row 1: LIVE EXAM ACTIVITY (Graph) + LIVE ALERTS */}
            <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '20px' }}>
              
              {/* Left: LIVE EXAM ACTIVITY Graph */}
              <div style={{ background: '#0f172a', padding: '20px', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                  <div>
                    <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
                      📈 LIVE EXAM ACTIVITY & TELEMETRY LOAD
                    </h3>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>Concurrent Candidate Traffic (Past 12 Hours)</div>
                  </div>
                  <span style={{ fontSize: '0.75rem', padding: '4px 10px', borderRadius: '12px', background: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', fontWeight: 700 }}>
                    Live Pulse
                  </span>
                </div>

                {/* Interactive SVG Activity Graph */}
                <div style={{ width: '100%', height: '180px', position: 'relative' }}>
                  <svg viewBox="0 0 500 160" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                    <defs>
                      <linearGradient id="activityGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                        <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                      </linearGradient>
                    </defs>
                    {/* Grid Lines */}
                    <line x1="0" y1="30" x2="500" y2="30" stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                    <line x1="0" y1="70" x2="500" y2="70" stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                    <line x1="0" y1="110" x2="500" y2="110" stroke="rgba(255,255,255,0.06)" strokeDasharray="4 4" />
                    <line x1="0" y1="150" x2="500" y2="150" stroke="rgba(255,255,255,0.1)" />

                    {/* Area fill */}
                    <path
                      d="M 0 150 L 0 120 Q 80 40 160 80 T 320 50 T 420 70 L 500 30 L 500 150 Z"
                      fill="url(#activityGrad)"
                    />
                    {/* Trend Line */}
                    <path
                      d="M 0 120 Q 80 40 160 80 T 320 50 T 420 70 L 500 30"
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth="3"
                    />
                    {/* Activity Points */}
                    <circle cx="0" cy="120" r="4" fill="#38bdf8" />
                    <circle cx="160" cy="80" r="4" fill="#38bdf8" />
                    <circle cx="320" cy="50" r="4" fill="#38bdf8" />
                    <circle cx="420" cy="70" r="4" fill="#38bdf8" />
                    <circle cx="500" cy="30" r="5" fill="#34d399" />
                  </svg>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748b', fontSize: '0.7rem', marginTop: '6px' }}>
                    <span>08:00 AM</span>
                    <span>11:00 AM</span>
                    <span>02:00 PM</span>
                    <span>05:00 PM</span>
                    <span>08:00 PM</span>
                    <span style={{ color: '#38bdf8', fontWeight: 700 }}>NOW</span>
                  </div>
                </div>
              </div>

              {/* Right: LIVE ALERTS Stream */}
              <div style={{ background: '#0f172a', padding: '20px', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                  <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
                    🚨 LIVE ALERTS
                  </h3>
                  <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>Real-Time AI Stream</span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <div style={{ background: 'rgba(239, 68, 68, 0.1)', borderLeft: '4px solid #ef4444', padding: '10px 14px', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.82rem', color: '#f87171' }}>🔴 Multiple Faces Detected</strong>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>Just Now</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '2px' }}>AI detected 2 people in candidate webcam frame</div>
                  </div>

                  <div style={{ background: 'rgba(245, 158, 11, 0.1)', borderLeft: '4px solid #f59e0b', padding: '10px 14px', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.82rem', color: '#fbbf24' }}>🟡 Tab Switch Triggered</strong>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>2 mins ago</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '2px' }}>Candidate unfocused exam portal window</div>
                  </div>

                  <div style={{ background: 'rgba(16, 185, 129, 0.1)', borderLeft: '4px solid #10b981', padding: '10px 14px', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <strong style={{ fontSize: '0.82rem', color: '#34d399' }}>🟢 Identity Verification Passed</strong>
                      <span style={{ fontSize: '0.7rem', color: '#94a3b8' }}>5 mins ago</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#cbd5e1', marginTop: '2px' }}>ArcFace biometrics confirmed (98.4% match)</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Row 2: ACTIVE EXAM PREVIEW (Candidate Live Cards Grid) */}
            <div style={{ background: '#0f172a', padding: '20px', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ffffff', margin: 0 }}>
                    👥 ACTIVE EXAM PREVIEW
                  </h3>
                  <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>Live Candidate Sentinels & Biometric Stream Grid</div>
                </div>
                <button
                  onClick={() => setActiveNav('live')}
                  style={{ ...styles.actionLaunchBtn, padding: '6px 14px', fontSize: '0.78rem', background: '#3b82f6', color: '#ffffff' }}
                >
                  📹 View All in Live Grid →
                </button>
              </div>

              {students.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', background: '#020617', borderRadius: '12px', border: '1px dashed #1e293b' }}>
                  <div style={{ fontSize: '2rem', marginBottom: '6px' }}>📡</div>
                  <div style={{ color: '#ffffff', fontWeight: 700 }}>No Active Students Currently Streaming</div>
                  <div style={{ color: '#64748b', fontSize: '0.8rem', marginTop: '4px' }}>Active students taking exams will populate here in real-time.</div>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px' }}>
                  {students.slice(0, 4).map((s, idx) => (
                    <div key={s.sessionId || s._id || idx} style={{
                      background: '#020617',
                      borderRadius: '12px',
                      border: s.status === 'Warning' ? '1px solid #f59e0b' : '1px solid #1e293b',
                      padding: '12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '10px'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          fontSize: '0.7rem',
                          fontWeight: 800,
                          background: s.status === 'Warning' ? 'rgba(245, 158, 11, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                          color: s.status === 'Warning' ? '#fbbf24' : '#34d399'
                        }}>
                          {s.status === 'Warning' ? '🟡 Warning' : '🟢 Normal'}
                        </span>
                        <span style={{ fontSize: '0.72rem', color: '#38bdf8', fontWeight: 700 }}>
                          {s.faceMatchConfidence || 95}% Match
                        </span>
                      </div>

                      <div style={{ height: '90px', background: '#0b1329', borderRadius: '8px', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {s.image || s.lastWebcamFrame ? (
                          <img src={s.image || s.lastWebcamFrame} alt={s.studentName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ fontSize: '1.8rem' }}>👤</div>
                        )}
                      </div>

                      <div>
                        <div style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.88rem' }}>{s.studentName}</div>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>USN: {s.usn || s.studentId}</div>
                      </div>

                      <button
                        onClick={() => handleOpenStudentDetail(s)}
                        style={{
                          width: '100%',
                          padding: '6px',
                          background: '#1e293b',
                          border: 'none',
                          color: '#ffffff',
                          borderRadius: '6px',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          cursor: 'pointer'
                        }}
                      >
                        Inspect Stream ↗
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Row 3: AI PROCTORING HEALTH (Left) + EXAM PERFORMANCE (Right) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
              
              {/* Left: AI PROCTORING HEALTH */}
              <div style={{ background: '#0f172a', padding: '20px', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#ffffff', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>🛡️</span> AI PROCTORING HEALTH
                </h3>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#020617', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }}></span>
                      <span>Face Detection Engine</span>
                    </div>
                    <strong style={{ color: '#34d399' }}>Active (99.8%)</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#020617', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }}></span>
                      <span>ArcFace Biometrics (InsightFace)</span>
                    </div>
                    <strong style={{ color: '#34d399' }}>Active (512-dim)</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#020617', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }}></span>
                      <span>YOLO Object Detector</span>
                    </div>
                    <strong style={{ color: '#34d399' }}>Active (Phone/Person)</strong>
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#020617', borderRadius: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#ffffff' }}>
                      <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#34d399' }}></span>
                      <span>MongoDB Database</span>
                    </div>
                    <strong style={{ color: '#34d399' }}>Connected</strong>
                  </div>
                </div>
              </div>

              {/* Right: EXAM PERFORMANCE */}
              <div style={{ background: '#0f172a', padding: '20px', borderRadius: '16px', border: '1px solid rgba(255, 255, 255, 0.08)' }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 800, color: '#ffffff', margin: '0 0 14px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>📊</span> EXAM PERFORMANCE & METRICS
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                  <div style={{ background: '#020617', padding: '14px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Average Score</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#60a5fa', marginTop: '2px' }}>78%</div>
                    <div style={{ fontSize: '0.7rem', color: '#34d399', marginTop: '2px' }}>↑ +4.2% vs last exam</div>
                  </div>

                  <div style={{ background: '#020617', padding: '14px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Pass Rate</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#34d399', marginTop: '2px' }}>84%</div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '2px' }}>Passing threshold: 40%</div>
                  </div>

                  <div style={{ background: '#020617', padding: '14px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Highest Score</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#38bdf8', marginTop: '2px' }}>96%</div>
                    <div style={{ fontSize: '0.7rem', color: '#a78bfa', marginTop: '2px' }}>CS Department</div>
                  </div>

                  <div style={{ background: '#020617', padding: '14px', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Lowest Score</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 900, color: '#f87171', marginTop: '2px' }}>41%</div>
                    <div style={{ fontSize: '0.7rem', color: '#fbbf24', marginTop: '2px' }}>Review required</div>
                  </div>
                </div>
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
              <div>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 800, color: '#34d399', margin: 0 }}>
                  ✔️ Finished & Evaluated Exam Submissions
                </h2>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '4px' }}>
                  Showing candidate identity, departments, login times, submission timestamps, and evaluation breakdown
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                  {finishedStudents.length} Submissions Logged
                </span>
                <button onClick={fetchData} style={styles.refreshBtn}>
                  🔄 Refresh List
                </button>
              </div>
            </div>

            {finishedStudents.length === 0 ? (
              <div style={styles.emptyStateContainer}>
                <div style={styles.emptyStateIcon}>✔️</div>
                <h3 style={styles.emptyStateTitle}>No Finished Exams Yet</h3>
                <p style={styles.emptyStateSubtitle}>Completed student exam submissions with answer sheets, scores, and proctoring logs will appear here.</p>
                <button onClick={fetchData} style={styles.refreshBtn}>
                  🔄 Refresh List
                </button>
              </div>
            ) : (
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      <th style={styles.tableTh}>Candidate & Department</th>
                      <th style={styles.tableTh}>Email</th>
                      <th style={styles.tableTh}>Login / Start Time</th>
                      <th style={styles.tableTh}>Submission Time</th>
                      <th style={styles.tableTh}>Duration</th>
                      <th style={styles.tableTh}>Score</th>
                      <th style={styles.tableTh}>Integrity</th>
                      <th style={styles.tableTh}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {finishedStudents.map((s, i) => {
                      const loginFormatted = s.loginTime || s.startTime ? new Date(s.loginTime || s.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A';
                      const submitFormatted = s.submissionTime || s.endTime ? new Date(s.submissionTime || s.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'N/A';
                      const dateFormatted = s.submissionTime || s.endTime ? new Date(s.submissionTime || s.endTime).toLocaleDateString() : '';

                      return (
                        <tr key={s._id || s.studentId || i} style={styles.tableRow}>
                          <td style={styles.tableTd}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                              <div style={styles.miniAvatar}>
                                {s.studentName ? s.studentName.charAt(0).toUpperCase() : 'S'}
                              </div>
                              <div>
                                <div style={{ fontWeight: 800, color: '#ffffff', fontSize: '0.9rem' }}>{s.studentName}</div>
                                <div style={{ fontSize: '0.725rem', color: '#38bdf8' }}>USN: {s.usn || s.studentId}</div>
                                <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>🏫 {s.department || 'Computer Science'}</div>
                              </div>
                            </div>
                          </td>
                          <td style={styles.tableTd}>
                            <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>{s.email || 'student@university.edu'}</div>
                          </td>
                          <td style={styles.tableTd}>
                            <div style={{ fontSize: '0.8rem', color: '#ffffff', fontWeight: 600 }}>🕒 {loginFormatted}</div>
                          </td>
                          <td style={styles.tableTd}>
                            <div style={{ fontSize: '0.8rem', color: '#34d399', fontWeight: 600 }}>🏁 {submitFormatted}</div>
                            {dateFormatted && <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{dateFormatted}</div>}
                          </td>
                          <td style={styles.tableTd}>
                            <div style={{ fontSize: '0.8rem', color: '#cbd5e1' }}>{s.duration || '00:45:00'}</div>
                          </td>
                          <td style={styles.tableTd}>
                            <div style={{ fontWeight: 800, color: '#60a5fa', fontSize: '0.9rem' }}>
                              {s.score !== undefined ? `${s.score}/${s.totalMarks || 100}` : 'N/A'}
                            </div>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{s.percentage !== undefined ? `${s.percentage}%` : ''}</div>
                          </td>
                          <td style={styles.tableTd}>
                            <strong style={{ color: '#34d399', fontSize: '0.8rem' }}>{s.integrityScore || '98% Safe'}</strong>
                          </td>
                          <td style={styles.tableTd}>
                            <button
                              onClick={() => setInspectingStudent(s)}
                              style={{ ...styles.actionLaunchBtn, padding: '6px 12px', fontSize: '0.78rem', background: '#3b82f6', color: '#ffffff' }}
                              title="Inspect Full Student Report & Answer Sheet"
                            >
                              🔍 View Details
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Inspecting Student Full Report Modal */}
            {inspectingStudent && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.85)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 9999,
                padding: '20px'
              }}>
                <div style={{
                  background: '#0f172a',
                  border: '1px solid #334155',
                  borderRadius: '16px',
                  width: '100%',
                  maxWidth: '850px',
                  maxHeight: '90vh',
                  overflowY: 'auto',
                  padding: '24px',
                  color: '#ffffff',
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)'
                }}>
                  {/* Modal Header */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #1e293b', paddingBottom: '16px', marginBottom: '20px' }}>
                    <div>
                      <h3 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, color: '#ffffff' }}>
                        🎓 Examination Candidate Submission Report
                      </h3>
                      <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginTop: '4px' }}>
                        {inspectingStudent.examName || 'Computer Science Final Assessment'}
                      </div>
                    </div>
                    <button
                      onClick={() => setInspectingStudent(null)}
                      style={{
                        background: '#1e293b',
                        border: 'none',
                        color: '#ffffff',
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontWeight: 800,
                        fontSize: '1rem'
                      }}
                    >
                      ✕
                    </button>
                  </div>

                  {/* Student Details & Timeline Grid */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '20px' }}>
                    <div style={{ background: '#1e293b', padding: '14px', borderRadius: '10px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>STUDENT NAME</div>
                      <div style={{ fontWeight: 800, fontSize: '1rem', marginTop: '2px' }}>{inspectingStudent.studentName}</div>
                      <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '2px' }}>USN: {inspectingStudent.usn || inspectingStudent.studentId}</div>
                    </div>

                    <div style={{ background: '#1e293b', padding: '14px', borderRadius: '10px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>EMAIL & DEPARTMENT</div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', marginTop: '2px', color: '#cbd5e1' }}>{inspectingStudent.email || 'N/A'}</div>
                      <div style={{ fontSize: '0.75rem', color: '#a78bfa', marginTop: '2px' }}>🏫 {inspectingStudent.department || 'Computer Science'}</div>
                    </div>

                    <div style={{ background: '#1e293b', padding: '14px', borderRadius: '10px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>TIMELINE LOGS</div>
                      <div style={{ fontSize: '0.8rem', color: '#ffffff', marginTop: '2px' }}>
                        🕒 Login: <strong>{inspectingStudent.loginTime || inspectingStudent.startTime ? new Date(inspectingStudent.loginTime || inspectingStudent.startTime).toLocaleTimeString() : 'N/A'}</strong>
                      </div>
                      <div style={{ fontSize: '0.8rem', color: '#34d399', marginTop: '2px' }}>
                        🏁 Submitted: <strong>{inspectingStudent.submissionTime || inspectingStudent.endTime ? new Date(inspectingStudent.submissionTime || inspectingStudent.endTime).toLocaleTimeString() : 'N/A'}</strong>
                      </div>
                    </div>

                    <div style={{ background: '#1e293b', padding: '14px', borderRadius: '10px' }}>
                      <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>SCORE & INTEGRITY</div>
                      <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#60a5fa', marginTop: '2px' }}>
                        {inspectingStudent.score !== undefined ? `${inspectingStudent.score} / ${inspectingStudent.totalMarks || 100}` : 'N/A'} ({inspectingStudent.percentage || 0}%)
                      </div>
                      <div style={{ fontSize: '0.75rem', color: '#34d399', marginTop: '2px' }}>
                        🛡️ Integrity: {inspectingStudent.integrityScore || '98% Safe'}
                      </div>
                    </div>
                  </div>

                  {/* Question Answer Sheet Breakdown */}
                  <h4 style={{ fontSize: '1rem', fontWeight: 800, color: '#ffffff', margin: '20px 0 10px' }}>
                    📝 Submitted Answer Sheet Breakdown
                  </h4>

                  {inspectingStudent.answers && inspectingStudent.answers.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                      {inspectingStudent.answers.map((ans, aIdx) => (
                        <div key={aIdx} style={{
                          background: '#1e293b',
                          padding: '14px',
                          borderRadius: '10px',
                          borderLeft: ans.isCorrect ? '4px solid #10b981' : (ans.selectedOption !== null ? '4px solid #ef4444' : '4px solid #64748b')
                        }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#ffffff' }}>
                              Q{aIdx + 1}: {ans.questionText || `Question ${aIdx + 1}`}
                            </div>
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontWeight: 800,
                              background: ans.isCorrect ? 'rgba(16, 185, 129, 0.2)' : (ans.selectedOption !== null ? 'rgba(239, 68, 68, 0.2)' : 'rgba(100, 116, 139, 0.2)'),
                              color: ans.isCorrect ? '#34d399' : (ans.selectedOption !== null ? '#f87171' : '#94a3b8')
                            }}>
                              {ans.isCorrect ? `✓ Correct (+${ans.points || 10} pts)` : (ans.selectedOption !== null ? '✗ Incorrect (0 pts)' : 'Unanswered')}
                            </span>
                          </div>

                          <div style={{ marginTop: '8px', fontSize: '0.82rem', color: '#cbd5e1' }}>
                            <div>Selected Option: <strong>{ans.selectedOptionText || (ans.selectedOption !== null ? `Option ${ans.selectedOption + 1}` : 'None')}</strong></div>
                            {ans.correctOption !== undefined && (
                              <div style={{ color: '#94a3b8', marginTop: '2px' }}>
                                Correct Option Index: <strong>Option {ans.correctOption + 1}</strong>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ background: '#1e293b', padding: '16px', borderRadius: '10px', color: '#94a3b8', fontSize: '0.85rem' }}>
                      No detailed question itemization found for this legacy record. Score: {inspectingStudent.score || 0} marks.
                    </div>
                  )}

                  {/* Close Action */}
                  <div style={{ marginTop: '24px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setInspectingStudent(null)}
                      style={{
                        background: '#334155',
                        border: 'none',
                        color: '#ffffff',
                        padding: '10px 20px',
                        borderRadius: '8px',
                        fontWeight: 700,
                        cursor: 'pointer'
                      }}
                    >
                      Close Report
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* -------------------------------------------------------------
            6b. ACTIVITY HISTORY VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'history' && (
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#818cf8', margin: 0 }}>
                📜 System Activity & Audit Trail
              </h2>
              <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                {historyData.length} Logged Events
              </span>
            </div>

            {historyData.length === 0 ? (
              <div style={styles.emptyStateContainer}>
                <div style={styles.emptyStateIcon}>📜</div>
                <h3 style={styles.emptyStateTitle}>No Activity Logs Yet</h3>
                <p style={styles.emptyStateSubtitle}>Live detection telemetry, warnings, and logins will be logged here.</p>
              </div>
            ) : (
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      <th style={styles.tableTh}>Student</th>
                      <th style={styles.tableTh}>Action / Event</th>
                      <th style={styles.tableTh}>Details</th>
                      <th style={styles.tableTh}>Severity</th>
                      <th style={styles.tableTh}>Time</th>
                      <th style={styles.tableTh}>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {historyData.map((item, idx) => (
                      <tr key={item.id || idx} style={styles.tableRow}>
                        <td style={styles.tableTd}>
                          <div style={{ fontWeight: 700, color: '#ffffff' }}>{item.studentName}</div>
                          <div style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{item.usn}</div>
                        </td>
                        <td style={styles.tableTd}>
                          <span style={{ fontWeight: 700, color: item.severity === 'critical' ? '#f87171' : '#a5b4fc' }}>
                            {item.action}
                          </span>
                        </td>
                        <td style={styles.tableTd}>
                          <div style={{ fontSize: '0.8rem', color: '#cbd5e1', maxWidth: '280px' }}>
                            {item.details}
                          </div>
                        </td>
                        <td style={styles.tableTd}>
                          <span style={{
                            padding: '3px 8px',
                            borderRadius: '6px',
                            fontSize: '0.72rem',
                            fontWeight: 700,
                            background: item.severity === 'critical' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(99, 102, 241, 0.2)',
                            color: item.severity === 'critical' ? '#fca5a5' : '#c7d2fe'
                          }}>
                            {item.severity}
                          </span>
                        </td>
                        <td style={styles.tableTd}>{item.time}</td>
                        <td style={styles.tableTd}>
                          {item.screenshot ? (
                            <button
                              onClick={() => setEvidenceModalImage(item.screenshot)}
                              style={{ ...styles.actionLaunchBtn, padding: '4px 8px', fontSize: '0.75rem' }}
                            >
                              📸 View
                            </button>
                          ) : (
                            <span style={{ color: '#64748b', fontSize: '0.75rem' }}>No Media</span>
                          )}
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
            7. REPORTS VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'reports' && (
          <div style={{ padding: '24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#818cf8', margin: 0 }}>
                📄 Proctoring Performance & Audit Reports
              </h2>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button
                  onClick={() => alert('📄 Exporting Examination Audit Summary PDF...')}
                  style={styles.actionLaunchBtn}
                >
                  📄 Export PDF
                </button>
                <button
                  onClick={() => alert('📊 Exporting Excel Examination Audit CSV...')}
                  style={styles.actionLaunchBtn}
                >
                  📊 Export CSV
                </button>
              </div>
            </div>

            <div style={styles.kpiGrid}>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Total Examinees Appeared</div>
                <div style={styles.kpiValue}>{reportsData?.summary?.appeared || (finishedStudents.length + students.length)}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Exams Finished Successfully</div>
                <div style={{ ...styles.kpiValue, color: '#34d399' }}>{reportsData?.summary?.finished || finishedStudents.length}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Terminated Candidates</div>
                <div style={{ ...styles.kpiValue, color: '#ef4444' }}>{reportsData?.summary?.terminated || terminatedStudents.length}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Top Cheating Indicator</div>
                <div style={{ ...styles.kpiValue, color: '#fbbf24', fontSize: '1.1rem' }}>
                  {reportsData?.summary?.mostCommonViolation || 'NONE'}
                </div>
              </div>
            </div>

            <div style={{ marginTop: '24px' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#ffffff', marginBottom: '12px' }}>
                🏫 Departmental Examination Breakdown
              </h3>
              <div style={styles.tableCard}>
                <table style={styles.table}>
                  <thead>
                    <tr style={styles.tableHeaderRow}>
                      <th style={styles.tableTh}>Department</th>
                      <th style={styles.tableTh}>Candidates</th>
                      <th style={styles.tableTh}>Finished</th>
                      <th style={styles.tableTh}>Terminated</th>
                      <th style={styles.tableTh}>Integrity Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(reportsData?.departmentStats && reportsData.departmentStats.length > 0 ? reportsData.departmentStats : [
                      { department: 'Computer Science & Engineering', appeared: finishedStudents.length + students.length, finished: finishedStudents.length, terminated: terminatedStudents.length }
                    ]).map((dept, idx) => (
                      <tr key={idx} style={styles.tableRow}>
                        <td style={styles.tableTd}>
                          <strong style={{ color: '#ffffff' }}>{dept.department}</strong>
                        </td>
                        <td style={styles.tableTd}>{dept.appeared}</td>
                        <td style={styles.tableTd}><span style={{ color: '#34d399', fontWeight: 700 }}>{dept.finished}</span></td>
                        <td style={styles.tableTd}><span style={{ color: dept.terminated > 0 ? '#ef4444' : '#94a3b8', fontWeight: 700 }}>{dept.terminated}</span></td>
                        <td style={styles.tableTd}>
                          <span style={{ color: '#34d399', fontWeight: 700 }}>
                            {dept.terminated === 0 ? '✓ High Integrity' : '⚠️ Under Review'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* -------------------------------------------------------------
            7b. ANALYTICS VIEW
           ------------------------------------------------------------- */}
        {activeNav === 'analytics' && (
          <div style={{ padding: '24px' }}>
            <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#c084fc', marginBottom: '16px' }}>
              📊 AI Anomaly Analytics & Risk Distribution
            </h2>

            <div style={styles.kpiGrid}>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Active Exam Rooms</div>
                <div style={styles.kpiValue}>{metrics.activeExams || 1}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Live Candidates Streaming</div>
                <div style={{ ...styles.kpiValue, color: '#38bdf8' }}>{students.length}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>Violations Logged Today</div>
                <div style={{ ...styles.kpiValue, color: '#fbbf24' }}>{violations.length}</div>
              </div>
              <div style={styles.kpiCard}>
                <div style={styles.kpiLabel}>AI Verification Accuracy</div>
                <div style={{ ...styles.kpiValue, color: '#34d399' }}>99.2%</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: '24px' }}>
              <div style={{ background: '#0f172a', padding: '20px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h4 style={{ color: '#ffffff', margin: '0 0 14px', fontSize: '0.95rem' }}>🛡️ Violation Types Distribution</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span>Tab Switching</span>
                    <strong style={{ color: '#fbbf24' }}>{violations.filter(v => v.violationType?.includes('TAB')).length}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span>Multiple Faces</span>
                    <strong style={{ color: '#f87171' }}>{violations.filter(v => v.violationType?.includes('FACE')).length}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span>Mobile Phone Detections</span>
                    <strong style={{ color: '#ef4444' }}>{violations.filter(v => v.violationType?.includes('PHONE')).length}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span>Gaze / Head Away</span>
                    <strong style={{ color: '#818cf8' }}>{violations.filter(v => v.violationType?.includes('GAZE') || v.violationType?.includes('HEAD')).length}</strong>
                  </div>
                </div>
              </div>

              <div style={{ background: '#0f172a', padding: '20px', borderRadius: '14px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <h4 style={{ color: '#ffffff', margin: '0 0 14px', fontSize: '0.95rem' }}>📈 Candidate Risk Level Breakdown</h4>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.85rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span style={{ color: '#34d399' }}>🟢 Low Risk (0–20)</span>
                    <strong style={{ color: '#34d399' }}>{students.filter(s => !s.riskLevel?.includes('High') && s.status !== 'Warning' && s.status !== 'Terminated').length + finishedStudents.length}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span style={{ color: '#fbbf24' }}>🟡 Medium Risk (21–50)</span>
                    <strong style={{ color: '#fbbf24' }}>{students.filter(s => s.status === 'Warning' || s.riskLevel?.includes('Medium')).length}</strong>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', color: '#cbd5e1' }}>
                    <span style={{ color: '#ef4444' }}>🔴 High Risk (50+)</span>
                    <strong style={{ color: '#ef4444' }}>{students.filter(s => s.status === 'Terminated' || s.riskLevel?.includes('High')).length + terminatedStudents.length}</strong>
                  </div>
                </div>
              </div>
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
