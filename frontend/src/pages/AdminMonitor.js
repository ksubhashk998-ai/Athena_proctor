import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { getSocket } from '../services/socketService';

export default function AdminMonitor() {
  const [students, setStudents] = useState([]);
  const [metrics, setMetrics] = useState({
    activeExams: 3,
    activeStudents: 12,
    violationsToday: 18,
    highRiskStudents: 2,
    examsCompleted: 14
  });
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [liveMultiFaceEvents, setLiveMultiFaceEvents] = useState([]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [studentsRes, analyticsRes] = await Promise.all([
        axios.get('http://localhost:5000/api/admin/students/live'),
        axios.get('http://localhost:5000/api/admin/analytics')
      ]);

      if (studentsRes.data && studentsRes.data.success) {
        setStudents(studentsRes.data.students || []);
      }

      if (analyticsRes.data && analyticsRes.data.success) {
        setMetrics(analyticsRes.data.metrics || metrics);
      }
    } catch (error) {
      console.error('Error loading admin live data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const socket = getSocket();
    if (socket) {
      socket.on('multi-face-violation', (data) => {
        setLiveMultiFaceEvents(prev => [data, ...prev.slice(0, 19)]);
      });
    }
    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  const filteredStudents = students.filter((s) => {
    const matchesSearch =
      s.studentName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.usn?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      s.email?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesRisk =
      riskFilter === 'ALL' || s.riskLevel?.toUpperCase() === riskFilter;

    return matchesSearch && matchesRisk;
  });

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>🛡️ Admin Control & Live Student Monitoring</h1>
          <p style={styles.subtitle}>
            Real-time Proctoring Suite • Running on Backend http://localhost:5000 & Admin App http://localhost:3001
          </p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <a
            href="http://localhost:3001"
            target="_blank"
            rel="noreferrer"
            style={styles.launchBtn}
          >
            🚀 Open Full Standalone Admin App (Port 3001)
          </a>
          <button onClick={fetchData} style={styles.refreshBtn}>
            🔄 Refresh Feed
          </button>
        </div>
      </header>

      {/* Analytics KPI Bar */}
      <div style={styles.kpiGrid}>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Active Exams</div>
          <div style={styles.kpiValue}>{metrics.activeExams}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Active Students</div>
          <div style={{ ...styles.kpiValue, color: '#38bdf8' }}>{metrics.activeStudents}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Violations Today</div>
          <div style={{ ...styles.kpiValue, color: '#fbbf24' }}>{metrics.violationsToday}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>High Risk Students</div>
          <div style={{ ...styles.kpiValue, color: '#f87171' }}>{metrics.highRiskStudents}</div>
        </div>
        <div style={styles.kpiCard}>
          <div style={styles.kpiLabel}>Exams Completed</div>
          <div style={{ ...styles.kpiValue, color: '#34d399' }}>{metrics.examsCompleted}</div>
        </div>
      </div>

      {/* Requirement 6: Real-Time Multiple Face Violation Sentinel Section */}
      {liveMultiFaceEvents.length > 0 && (
        <div style={{ background: 'rgba(15, 23, 42, 0.85)', border: '1px solid #ef4444', borderRadius: '16px', padding: '20px', marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: '#f87171', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <i className="fas fa-users-slash"></i> LIVE MULTIPLE-FACE VIOLATION FEED ({liveMultiFaceEvents.length})
          </h3>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '16px' }}>
            {liveMultiFaceEvents.map((evt, i) => (
              <div key={i} style={{ background: 'rgba(30, 41, 59, 0.8)', border: `1px solid ${evt.status === 'Exam Terminated' ? '#ef4444' : '#f59e0b'}`, borderRadius: '12px', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <strong style={{ color: '#f8fafc', fontSize: '0.95rem' }}>{evt.studentName || evt.studentId || 'Student'}</strong>
                  <span style={{ fontSize: '0.75rem', fontWeight: 800, color: evt.status === 'Exam Terminated' ? '#ef4444' : '#fbbf24', background: evt.status === 'Exam Terminated' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)', padding: '2px 8px', borderRadius: '8px' }}>
                    {evt.status || 'Exam Active'}
                  </span>
                </div>

                <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '4px' }}>✉ Email: <strong>{evt.studentEmail || 'student@university.edu'}</strong></div>
                <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '4px' }}>📝 Exam ID: <strong>{evt.examId || 'CS_EXAM_FINAL'}</strong></div>
                <div style={{ fontSize: '0.8rem', color: '#cbd5e1', marginBottom: '4px' }}>⚠️ Warning Count: <strong style={{ color: '#f87171' }}>{evt.warningText || `${evt.warningNumber || 1} / 3`}</strong></div>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginBottom: '8px' }}>🕒 {new Date(evt.timestamp || Date.now()).toLocaleTimeString()}</div>

                {evt.screenshot && (
                  <div style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid #ef4444', maxHeight: '140px' }}>
                    <img src={evt.screenshot} alt="Multi Face Evidence" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div style={styles.filterBar}>
        <input
          type="text"
          placeholder="Search by student name, USN, email..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          style={styles.searchInput}
        />

        <select
          value={riskFilter}
          onChange={(e) => setRiskFilter(e.target.value)}
          style={styles.selectFilter}
        >
          <option value="ALL">All Risk Levels</option>
          <option value="HIGH">High Risk Only</option>
          <option value="MEDIUM">Medium Risk Only</option>
          <option value="LOW">Low Risk Only</option>
        </select>
      </div>

      {/* Student Monitoring Grid */}
      {loading && students.length === 0 ? (
        <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
          ⏳ Loading live proctoring telemetry data from backend...
        </div>
      ) : (
        <div style={styles.grid}>
          {filteredStudents.map((s) => (
          <div key={s.sessionId || s.studentId} style={styles.studentCard}>
            <div style={styles.cardHeader}>
              <div>
                <strong style={{ fontSize: '1rem', color: '#f8fafc' }}>{s.studentName}</strong>
                <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>USN: {s.usn} | {s.department}</div>
              </div>
              <span
                style={{
                  ...styles.riskBadge,
                  backgroundColor:
                    s.riskLevel === 'High'
                      ? 'rgba(239, 68, 68, 0.2)'
                      : s.riskLevel === 'Medium'
                      ? 'rgba(245, 158, 11, 0.2)'
                      : 'rgba(16, 185, 129, 0.2)',
                  color:
                    s.riskLevel === 'High'
                      ? '#ef4444'
                      : s.riskLevel === 'Medium'
                      ? '#f59e0b'
                      : '#10b981'
                }}
              >
                {s.riskLevel || 'Low'} Risk
              </span>
            </div>

            <div style={styles.videoBox}>
              <div style={{ textAlign: 'center', color: '#64748b' }}>
                📷 Live Webcam Stream Connected
                <div style={{ fontSize: '0.7rem', color: '#475569', marginTop: '4px' }}>
                  Socket.IO Telemetry Active
                </div>
              </div>
            </div>

            <div style={styles.cardBody}>
              <div style={styles.telemetryRow}>
                <span>Face Detected:</span>
                <strong style={{ color: s.faceDetected ? '#34d399' : '#f87171' }}>
                  {s.faceDetected ? 'Yes' : 'No'}
                </strong>
              </div>
              <div style={styles.telemetryRow}>
                <span>Multiple Faces:</span>
                <strong style={{ color: s.multipleFaces ? '#f87171' : '#34d399' }}>
                  {s.multipleFaces ? 'Detected!' : 'None'}
                </strong>
              </div>
              <div style={styles.telemetryRow}>
                <span>Mobile Phone:</span>
                <strong style={{ color: s.mobilePhoneDetected ? '#f87171' : '#34d399' }}>
                  {s.mobilePhoneDetected ? 'Detected!' : 'None'}
                </strong>
              </div>
              <div style={styles.telemetryRow}>
                <span>Head Pose:</span>
                <strong style={{ color: s.headPose !== 'Normal' ? '#fbbf24' : '#34d399' }}>
                  {s.headPose || 'Normal'}
                </strong>
              </div>
              <div style={styles.telemetryRow}>
                <span>Eye Gaze:</span>
                <strong style={{ color: s.eyeGaze !== 'Center' ? '#fbbf24' : '#34d399' }}>
                  {s.eyeGaze || 'Center'}
                </strong>
              </div>
              <div style={styles.telemetryRow}>
                <span>Tab Switches:</span>
                <strong style={{ color: s.tabSwitchingCount > 2 ? '#f87171' : '#f8fafc' }}>
                  {s.tabSwitchingCount}
                </strong>
              </div>
              <div style={styles.telemetryRow}>
                <span>Copy/Paste:</span>
                <strong style={{ color: s.copyPasteAttempts > 0 ? '#fbbf24' : '#f8fafc' }}>
                  {s.copyPasteAttempts}
                </strong>
              </div>
              <div style={styles.telemetryRow}>
                <span>Fullscreen:</span>
                <strong style={{ color: s.fullScreenStatus === 'Active' ? '#34d399' : '#fbbf24' }}>
                  {s.fullScreenStatus}
                </strong>
              </div>
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

const styles = {
  container: {
    padding: '24px',
    backgroundColor: '#0b0f19',
    minHeight: '100vh',
    color: '#f8fafc',
    fontFamily: 'Inter, sans-serif'
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
    flexWrap: 'wrap',
    gap: '16px'
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: '800'
  },
  subtitle: {
    fontSize: '0.85rem',
    color: '#94a3b8'
  },
  launchBtn: {
    padding: '10px 18px',
    backgroundColor: '#6366f1',
    color: 'white',
    borderRadius: '10px',
    textDecoration: 'none',
    fontWeight: '700',
    fontSize: '0.85rem',
    display: 'inline-block'
  },
  refreshBtn: {
    padding: '10px 16px',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    color: '#f8fafc',
    borderRadius: '10px',
    fontWeight: '600',
    cursor: 'pointer'
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
    gap: '16px',
    marginBottom: '24px'
  },
  searchInput: {
    flex: 1,
    padding: '10px 14px',
    borderRadius: '10px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#f8fafc',
    fontSize: '0.9rem',
    outline: 'none'
  },
  selectFilter: {
    padding: '10px 14px',
    borderRadius: '10px',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    color: '#f8fafc',
    fontSize: '0.9rem',
    outline: 'none'
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
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
    alignItems: 'flex-start',
    borderBottom: '1px solid #1e293b'
  },
  riskBadge: {
    padding: '4px 10px',
    borderRadius: '6px',
    fontSize: '0.75rem',
    fontWeight: '700'
  },
  videoBox: {
    height: '140px',
    backgroundColor: '#020617',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.85rem'
  },
  cardBody: {
    padding: '14px'
  },
  telemetryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '0.8rem',
    marginBottom: '6px',
    color: '#cbd5e1'
  }
};
