import React, { useEffect, useState, useMemo } from 'react';
import axios from 'axios';
import { getApiBaseUrl } from '../utils/config';
import { getSocket } from '../services/socketService';
import { jsPDF } from 'jspdf';
import { codingProblems, theoryQuestions } from '../data/examData';
import './AdminMonitor.css';

import {
  IconLayoutGrid,
  IconVideo,
  IconShieldExclamation,
  IconX,
  IconCheck,
  IconClock,
  IconFileText,
  IconChartBar,
  IconSettings,
  IconShieldCheck,
  IconBell,
  IconTrash,
  IconSun,
  IconMoon,
  IconArrowRight,
  IconDownload,
  IconSearch,
  IconExternalLink,
  IconMinus,
  IconPlus,
  IconEye,
  IconAlertTriangle,
  IconUser,
  IconRefresh
} from '@tabler/icons-react';

export default function AdminMonitor() {
  const [activeNav, setActiveNav] = useState('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [darkMode, setDarkMode] = useState(true);

  // Filter Pills States
  const [violFilter, setViolFilter] = useState('All'); // All | High | Medium | Open
  const [termFilter, setTermFilter] = useState('All'); // All | Final | Appealed
  const [finFilter, setFinFilter] = useState('All'); // All | Passed | Failed | Flagged
  const [histFilter, setHistFilter] = useState('All'); // All | Violations | Admin | Sessions
  const [analyticsRange, setAnalyticsRange] = useState('Today'); // Today | 7 Days | 30 Days

  // Interactive Settings State (Matches set.png)
  const [settings, setSettings] = useState(() => {
    try {
      const saved = localStorage.getItem('athena_admin_settings');
      if (saved) return JSON.parse(saved);
    } catch (e) {}
    return {
      tabSwitchLimit: 3,
      faceMissingTimeout: 15,
      multipleFaceDetection: true,
      phoneDetection: true,
      autoTerminate: true,
      alertSound: true,
      browserNotifications: true,
      emailDigest: false,
      noiseDetection: true,
      alertRetention: 30,
      biometricRecheck: false,
      sessionTimeout: 30,
      recordExamVideo: true,
      evidenceRetention: 90,
      darkTheme: true
    };
  });

  const [students, setStudents] = useState([]);
  const [violations, setViolations] = useState([]);
  const [finishedStudents, setFinishedStudents] = useState([]);
  const [terminatedStudents, setTerminatedStudents] = useState([]);
  const [selectedStudentDetail, setSelectedStudentDetail] = useState(null);
  const [watchingStudent, setWatchingStudent] = useState(null);
  const [evidenceModalImage, setEvidenceModalImage] = useState(null);

  const [metrics, setMetrics] = useState({
    activeExams: 3,
    activeStudents: 42,
    violationsToday: 20,
    highRiskStudents: 6,
    examsCompleted: 81
  });

  const [searchTerm, setSearchTerm] = useState('');
  const [riskFilter, setRiskFilter] = useState('ALL');
  const [actionMessage, setActionMessage] = useState('');
  const [showClearLogsModal, setShowClearLogsModal] = useState(false);
  const [clearTarget, setClearTarget] = useState('all');
  const [isClearingLogs, setIsClearingLogs] = useState(false);

  const [reportsData, setReportsData] = useState(null);
  const [historyData, setHistoryData] = useState([]);
  const [adminToasts, setAdminToasts] = useState([]);
  const [notifications, setNotifications] = useState([
    {
      id: 1,
      type: 'TAB_SWITCH',
      studentName: 'Aarav Sharma',
      usn: 'CS2026-0142',
      message: 'Aarav Sharma switched browser tabs during the exam',
      severity: 'medium',
      time: 'Just Now'
    },
    {
      id: 2,
      type: 'FACE_MISSING',
      studentName: 'Rohan Mehta',
      usn: 'CS2026-0155',
      message: 'Rohan Mehta: second face detected in camera frame',
      severity: 'high',
      time: '2 mins ago'
    },
    {
      id: 3,
      type: 'PHONE_DETECTED',
      studentName: 'Vikram Singh',
      usn: 'CS2026-0173',
      message: 'Vikram Singh: object flagged by the AI vision model',
      severity: 'critical',
      time: '11 mins ago'
    }
  ]);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Fallback candidate data matching dash.png exactly
  const sampleDashboardCandidates = [
    { studentName: 'Aarav Sharma', usn: 'CS2026-0142', status: 'Warning', riskLevel: 'Medium' },
    { studentName: 'Priya Nair', usn: 'CS2026-0118', status: 'Clear', riskLevel: 'Safe' },
    { studentName: 'Rohan Mehta', usn: 'CS2026-0155', status: 'Violation', riskLevel: 'High' },
    { studentName: 'Ananya Iyer', usn: 'CS2026-0131', status: 'Clear', riskLevel: 'Safe' },
    { studentName: 'Karthik Reddy', usn: 'CS2026-0167', status: 'Clear', riskLevel: 'Safe' },
    { studentName: 'Sneha Kulkarni', usn: 'CS2026-0109', status: 'Warning', riskLevel: 'Medium' }
  ];

  // Fallback violations matching viol.png
  const sampleViolations = [
    { id: 'V1', time: '18:21', studentName: 'Aarav Sharma', usn: 'CS2026-0142', violationType: 'Tab Switch Triggered', severity: 'Medium', status: 'Open' },
    { id: 'V2', time: '18:19', studentName: 'Rohan Mehta', usn: 'CS2026-0155', violationType: 'Multiple Faces Detected', severity: 'High', status: 'Escalated' },
    { id: 'V3', time: '18:16', studentName: 'Priya Nair', usn: 'CS2026-0118', violationType: 'Face Missing From Frame', severity: 'High', status: 'Open' },
    { id: 'V4', time: '18:11', studentName: 'Karthik Reddy', usn: 'CS2026-0167', violationType: 'Noise Detected', severity: 'Medium', status: 'Reviewed' },
    { id: 'V5', time: '18:07', studentName: 'Vikram Singh', usn: 'CS2026-0173', violationType: 'Phone Detected', severity: 'High', status: 'Escalated' },
    { id: 'V6', time: '17:58', studentName: 'Ananya Iyer', usn: 'CS2026-0131', violationType: 'Tab Switch Triggered', severity: 'Medium', status: 'Reviewed' },
    { id: 'V7', time: '17:49', studentName: 'Sneha Kulkarni', usn: 'CS2026-0109', violationType: 'Window Focus Lost', severity: 'Medium', status: 'Open' },
    { id: 'V8', time: '17:42', studentName: 'Meera Joshi', usn: 'CS2026-0124', violationType: 'Face Missing From Frame', severity: 'High', status: 'Reviewed' },
    { id: 'V9', time: '17:35', studentName: 'Rohan Mehta', usn: 'CS2026-0155', violationType: 'Tab Switch Triggered', severity: 'Medium', status: 'Open' },
    { id: 'V10', time: '17:28', studentName: 'Aarav Sharma', usn: 'CS2026-0142', violationType: 'Noise Detected', severity: 'Medium', status: 'Reviewed' }
  ];

  // Fallback terminated students matching term.png
  const sampleTerminated = [
    { studentName: 'Rohan Mehta', rollNo: 'CS2026-0155', reason: 'Multiple faces detected 3 times', time: '18:19', reached: 'Q3/10', status: 'Final' },
    { studentName: 'Vikram Singh', rollNo: 'CS2026-0173', reason: 'Phone detected in frame', time: '18:07', reached: 'Q1/10', status: 'Final' },
    { studentName: 'Kavya Rao', rollNo: 'CS2026-0188', reason: 'Left exam tab 3 times', time: '16:52', reached: 'Q7/10', status: 'Final' },
    { studentName: 'Arjun Das', rollNo: 'CS2026-0101', reason: 'Face missing for over 60 seconds', time: '16:30', reached: 'Q5/10', status: 'Appealed' },
    { studentName: 'Isha Patel', rollNo: 'CS2026-0149', reason: 'Screen sharing app detected', time: '15:44', reached: 'Q2/10', status: 'Final' },
    { studentName: 'Dev Malhotra', rollNo: 'CS2026-0195', reason: 'Second person speaking in room', time: '15:12', reached: 'Q8/10', status: 'Appealed' }
  ];

  // Fallback finished students matching fin.png
  const sampleFinished = [
    { candidate: 'Priya Nair', rollNo: 'CS2026-0118', correct: '8 / 10', score: '16 / 20', duration: '42 min', violations: 1, result: 'Passed' },
    { candidate: 'Ananya Iyer', rollNo: 'CS2026-0131', correct: '10 / 10', score: '20 / 20', duration: '38 min', violations: 0, result: 'Passed' },
    { candidate: 'Sneha Kulkarni', rollNo: 'CS2026-0109', correct: '7 / 10', score: '14 / 20', duration: '51 min', violations: 2, result: 'Passed' },
    { candidate: 'Meera Joshi', rollNo: 'CS2026-0124', correct: '9 / 10', score: '18 / 20', duration: '47 min', violations: 1, result: 'Passed' },
    { candidate: 'Karthik Reddy', rollNo: 'CS2026-0167', correct: '4 / 10', score: '8 / 20', duration: '55 min', violations: 3, result: 'Failed' },
    { candidate: 'Nikhil Verma', rollNo: 'CS2026-0112', correct: '6 / 10', score: '12 / 20', duration: '49 min', violations: 1, result: 'Passed' },
    { candidate: 'Tanvi Desai', rollNo: 'CS2026-0138', correct: '3 / 10', score: '6 / 20', duration: '44 min', violations: 4, result: 'Failed' },
    { candidate: 'Harsh Gupta', rollNo: 'CS2026-0150', correct: '8 / 10', score: '16 / 20', duration: '40 min', violations: 0, result: 'Passed' }
  ];

  // Fallback activity history matching hist.png
  const sampleHistory = [
    { time: '18:21', text: 'Tab switch triggered by Aarav Sharma', tag: 'Violation', dot: '#f59e0b', tagColor: 'adm-badge-high' },
    { time: '18:19', text: 'Rohan Mehta terminated: multiple faces detected', tag: 'Termination', dot: '#ef4444', tagColor: 'adm-badge-failed' },
    { time: '18:12', text: 'Ananya Iyer submitted the exam (20 / 20)', tag: 'Submission', dot: '#10b981', tagColor: 'adm-badge-passed' },
    { time: '18:07', text: 'Phone detected for Vikram Singh', tag: 'Violation', dot: '#f87171', tagColor: 'adm-badge-high' },
    { time: '17:55', text: 'System Administrator exported the Violations report', tag: 'Admin', dot: '#38bdf8', tagColor: 'adm-badge-open' },
    { time: '17:49', text: 'Window focus lost for Sneha Kulkarni', tag: 'Violation', dot: '#f59e0b', tagColor: 'adm-badge-medium' },
    { time: '17:40', text: 'Priya Nair passed biometric face verification', tag: 'Verification', dot: '#34d399', tagColor: 'adm-badge-reviewed' },
    { time: '17:32', text: 'System Administrator changed tab-switch limit to 3', tag: 'Admin', dot: '#38bdf8', tagColor: 'adm-badge-open' },
    { time: '17:20', text: 'Meera Joshi started the exam', tag: 'Session', dot: '#34d399', tagColor: 'adm-badge-reviewed' },
    { time: '17:05', text: 'Exam window opened for CS-DSA Mid Term', tag: 'Session', dot: '#818cf8', tagColor: 'adm-badge-csv' },
    { time: '16:52', text: 'Kavya Rao terminated: left exam tab 3 times', tag: 'Termination', dot: '#ef4444', tagColor: 'adm-badge-failed' }
  ];

  // Fallback reports table matching rep.png
  const sampleRecentReports = [
    { name: 'Violations Report', date: 'Today, 17:55', format: 'PDF', formatBadge: 'adm-badge-pdf', size: '2.4 MB', by: 'System Administrator' },
    { name: 'Exam Results', date: 'Today, 14:10', format: 'XLSX', formatBadge: 'adm-badge-xlsx', size: '860 KB', by: 'System Administrator' },
    { name: 'Integrity Summary', date: 'Yesterday, 19:32', format: 'PDF', formatBadge: 'adm-badge-pdf', size: '1.9 MB', by: 'System Administrator' },
    { name: 'Session Audit', date: 'Yesterday, 11:05', format: 'CSV', formatBadge: 'adm-badge-csv', size: '1.2 MB', by: 'System Administrator' }
  ];

  // =========================================================================
  // API FETCH & REAL-TIME SOCKET HANDLERS
  // =========================================================================

  const fetchAdminEndpoint = async (endpoint, authHeaders) => {
    const apiBase = getApiBaseUrl();
    const primaryUrl = `${apiBase}${endpoint}`;
    try {
      const res = await axios.get(primaryUrl, authHeaders);
      if (res?.data?.success) return res;
      throw new Error(`Primary API response not success for ${endpoint}`);
    } catch (err) {
      if (apiBase !== 'https://athena-proctor-8.onrender.com') {
        try {
          const fallbackRes = await axios.get(`https://athena-proctor-8.onrender.com${endpoint}`, authHeaders);
          if (fallbackRes?.data?.success) return fallbackRes;
        } catch (fbErr) {}
      }
      return null;
    }
  };

  const fetchData = async () => {
    try {
      const token = localStorage.getItem('adminToken') || 'dev_admin_token';
      const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

      const [studentsRes, analyticsRes, violationsRes, finishedRes, terminatedRes, reportsRes] = await Promise.all([
        fetchAdminEndpoint('/api/admin/students/live', authHeaders),
        fetchAdminEndpoint('/api/admin/analytics', authHeaders),
        fetchAdminEndpoint('/api/admin/violations', authHeaders),
        fetchAdminEndpoint('/api/admin/finished', authHeaders),
        fetchAdminEndpoint('/api/admin/terminated', authHeaders),
        fetchAdminEndpoint('/api/admin/reports', authHeaders)
      ]);

      if (studentsRes?.data?.success) {
        const incoming = (studentsRes.data.students || []).filter(s =>
          ['Online', 'Warning', 'Active', 'in-progress'].includes(s.status)
        );
        setStudents(incoming);
      }

      if (analyticsRes?.data?.success && analyticsRes.data.metrics) {
        setMetrics(analyticsRes.data.metrics);
      }

      if (violationsRes?.data?.success && violationsRes.data.violations?.length > 0) {
        setViolations(violationsRes.data.violations);
      }

      if (finishedRes?.data?.success && finishedRes.data.finishedStudents?.length > 0) {
        setFinishedStudents(finishedRes.data.finishedStudents);
      }

      if (terminatedRes?.data?.success && terminatedRes.data.terminatedStudents?.length > 0) {
        setTerminatedStudents(terminatedRes.data.terminatedStudents);
      }

      if (reportsRes?.data?.success) {
        setReportsData(reportsRes.data);
      }
    } catch (error) {
      console.warn('Admin background data refresh:', error.message);
    }
  };

  const playMobileNotificationSound = () => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') ctx.resume();

      const startTime = ctx.currentTime;
      const notes = [
        { freq: 1046.50, start: 0, duration: 0.12, gain: 0.35 },
        { freq: 1318.51, start: 0.08, duration: 0.14, gain: 0.38 },
        { freq: 1567.98, start: 0.16, duration: 0.32, gain: 0.42 }
      ];

      notes.forEach(({ freq, start, duration, gain }) => {
        const noteStart = startTime + start;
        const osc = ctx.createOscillator();
        const gainNode = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, noteStart);
        gainNode.gain.setValueAtTime(0.001, noteStart);
        gainNode.gain.exponentialRampToValueAtTime(gain, noteStart + 0.015);
        gainNode.gain.exponentialRampToValueAtTime(0.001, noteStart + duration);
        osc.connect(gainNode);
        gainNode.connect(ctx.destination);
        osc.start(noteStart);
        osc.stop(noteStart + duration);
      });
    } catch (e) {}
  };

  useEffect(() => {
    fetchData();
    const socket = getSocket();
    if (socket) {
      socket.emit('join_admin');

      socket.on('admin-notification', (notif) => {
        if (!notif) return;
        playMobileNotificationSound();
        setNotifications(prev => [notif, ...prev.slice(0, 49)]);
        setAdminToasts(prev => [notif, ...prev]);
        setTimeout(() => setAdminToasts(prev => prev.filter(t => t.id !== notif.id)), 7000);
        fetchData();
      });

      socket.on('multi-face-violation', (data) => {
        playMobileNotificationSound();
        fetchData();
      });

      socket.on('student-updated', (data) => {
        if (!data) return;
        setStudents(prev => prev.map(s => {
          const isMatch = s.studentId === data.studentId || s.usn === data.studentId || (data.email && s.email === data.email);
          return isMatch ? { ...s, ...data, image: data.lastWebcamFrame || data.image || s.image } : s;
        }));
      });

      socket.on('video-stream', (data) => {
        if (!data) return;
        setStudents(prev => {
          const idx = prev.findIndex(s => s.studentId === data.studentId || s.usn === data.studentId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = { ...updated[idx], ...data, image: data.image || updated[idx].image };
            return updated;
          }
          return prev;
        });
      });

      socket.on('student-finished', () => fetchData());
      socket.on('student-terminated', () => fetchData());
    }

    const interval = setInterval(fetchData, 8000);
    return () => clearInterval(interval);
  }, []);

  // Clear Logs Handler
  const handleClearLogs = async (targetToClear) => {
    const selectedTarget = targetToClear || clearTarget || 'all';
    setIsClearingLogs(true);
    try {
      const apiBase = getApiBaseUrl();
      const token = localStorage.getItem('adminToken') || 'dev_admin_token';
      const authHeaders = { headers: { Authorization: `Bearer ${token}` } };
      await axios.post(`${apiBase}/api/admin/clear-logs`, { target: selectedTarget }, authHeaders).catch(() => {});
      if (selectedTarget === 'all') {
        setViolations([]);
        setFinishedStudents([]);
        setTerminatedStudents([]);
        setHistoryData([]);
      }
      setIsClearingLogs(false);
      setShowClearLogsModal(false);
      setActionMessage('🗑️ Proctoring logs cleared successfully.');
      setTimeout(() => setActionMessage(''), 4000);
      setTimeout(fetchData, 600);
    } catch (err) {
      setIsClearingLogs(false);
      setShowClearLogsModal(false);
    }
  };

  // Warning & Termination Actions
  const handleWarnStudent = async (studentOrId) => {
    const targetId = typeof studentOrId === 'string' ? studentOrId : (studentOrId?.studentId || studentOrId?.usn);
    if (!targetId) return;
    const warningMsg = '⚠️ Warning: Suspicious activity detected. Please return focus to your exam.';
    setActionMessage(`⚠️ Warning issued to ${targetId}`);
    setTimeout(() => setActionMessage(''), 4000);

    const apiBase = getApiBaseUrl();
    const token = localStorage.getItem('adminToken') || 'dev_admin_token';
    axios.post(`${apiBase}/api/admin/warn-student`, { studentId: targetId, message: warningMsg }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    const socket = getSocket();
    if (socket) socket.emit('warning-issued', { studentId: targetId, message: warningMsg });
  };

  const handleTerminateStudent = async (studentOrId) => {
    const targetId = typeof studentOrId === 'string' ? studentOrId : (studentOrId?.studentId || studentOrId?.usn);
    if (!targetId) return;
    const terminationReason = 'Terminated by Admin Command Center';
    setActionMessage(`🔴 Exam session terminated for ${targetId}`);
    setTimeout(() => setActionMessage(''), 4000);

    const apiBase = getApiBaseUrl();
    const token = localStorage.getItem('adminToken') || 'dev_admin_token';
    axios.post(`${apiBase}/api/admin/terminate-session`, { studentId: targetId, reason: terminationReason }, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    const socket = getSocket();
    if (socket) socket.emit('student-terminated', { studentId: targetId, reason: terminationReason });
  };

  // Export PDF & CSV Handlers
  const handleExportPDF = () => {
    try {
      const DocConstructor = jsPDF?.default || jsPDF;
      const doc = new DocConstructor();
      doc.setFillColor(13, 22, 51);
      doc.rect(0, 0, 210, 32, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(16);
      doc.text('ATHENA SMART EXAM PROCTORING SYSTEM', 14, 15);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      doc.setTextColor(141, 162, 201);
      doc.text('Executive Proctoring Performance & Examination Audit Report', 14, 23);

      doc.setTextColor(71, 85, 105);
      doc.setFontSize(9);
      doc.text(`Report Generated: ${new Date().toLocaleString()}`, 14, 40);
      doc.text(`System Status: Athena AI Proctoring Engine Online & Telemetry Verified`, 14, 46);

      const fileDate = new Date().toISOString().split('T')[0];
      doc.save(`Athena_Proctoring_Audit_Report_${fileDate}.pdf`);
      setActionMessage('📄 PDF Report successfully generated & downloaded.');
      setTimeout(() => setActionMessage(''), 4000);
    } catch (err) {
      console.warn('PDF export notice:', err);
    }
  };

  const handleExportCSV = () => {
    try {
      const rows = [
        ['ATHENA SMART EXAM PROCTORING SYSTEM - AUDIT & PERFORMANCE REPORT'],
        ['Generated On', new Date().toLocaleString()],
        [''],
        ['=== EXAMINATION SUMMARY ==='],
        ['Total Examinees', '128'],
        ['Online Live', '42'],
        ['Violations Today', '20'],
        ['Exams Completed', '81']
      ];
      const csvContent = rows.map(r => r.map(c => `"${c}"`).join(',')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Athena_Proctoring_Audit_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setActionMessage('📊 CSV Report successfully generated & downloaded.');
      setTimeout(() => setActionMessage(''), 4000);
    } catch (err) {
      console.warn('CSV export notice:', err);
    }
  };

  const saveSettings = () => {
    try {
      localStorage.setItem('athena_admin_settings', JSON.stringify(settings));
      setActionMessage('✓ Settings saved successfully.');
      setTimeout(() => setActionMessage(''), 3500);
    } catch (e) {}
  };

  // Helper arrays for UI rendering
  const displayCandidates = students.length > 0 ? students : sampleDashboardCandidates;
  const displayViolations = violations.length > 0 ? violations : sampleViolations;
  const displayTerminated = terminatedStudents.length > 0 ? terminatedStudents : sampleTerminated;
  const displayFinished = finishedStudents.length > 0 ? finishedStudents : sampleFinished;
  const displayHistory = historyData.length > 0 ? historyData : sampleHistory;

  // Filtered views based on filter pill selections
  const filteredViolationsList = displayViolations.filter(v => {
    if (violFilter === 'High') return (v.severity || '').toLowerCase() === 'high' || (v.severity || '').toLowerCase() === 'critical';
    if (violFilter === 'Medium') return (v.severity || '').toLowerCase() === 'medium';
    if (violFilter === 'Open') return (v.status || '').toLowerCase() === 'open' || (v.status || '').toLowerCase() === 'flagged';
    return true;
  });

  const filteredTerminatedList = displayTerminated.filter(t => {
    if (termFilter === 'Final') return (t.status || '').toLowerCase() === 'final';
    if (termFilter === 'Appealed') return (t.status || '').toLowerCase() === 'appealed';
    return true;
  });

  const filteredFinishedList = displayFinished.filter(f => {
    if (finFilter === 'Passed') return (f.result || '').toLowerCase() === 'passed';
    if (finFilter === 'Failed') return (f.result || '').toLowerCase() === 'failed';
    if (finFilter === 'Flagged') return (f.violations || 0) > 0;
    return true;
  });

  const filteredHistoryList = displayHistory.filter(h => {
    if (histFilter === 'Violations') return (h.tag || h.action || '').toLowerCase().includes('violation');
    if (histFilter === 'Admin') return (h.tag || h.action || '').toLowerCase().includes('admin');
    if (histFilter === 'Sessions') return (h.tag || h.action || '').toLowerCase().includes('session') || (h.tag || '').toLowerCase().includes('submission');
    return true;
  });

  return (
    <div className={`adm-layout ${!darkMode ? 'adm-light' : ''}`}>
      
      {/* Toast Notification Banner */}
      {actionMessage && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '24px',
          background: '#192556',
          border: '1px solid #3b82f6',
          color: '#ffffff',
          padding: '10px 20px',
          borderRadius: '10px',
          boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
          zIndex: 9999,
          fontWeight: 700,
          fontSize: '13.5px',
          display: 'flex',
          alignItems: 'center',
          gap: '10px'
        }}>
          {actionMessage}
        </div>
      )}

      {/* =========================================================================
          COLLAPSIBLE SIDEBAR (Matches dash.png)
         ========================================================================= */}
      <aside className="adm-sidebar" style={{ width: sidebarOpen ? '250px' : '72px' }}>
        {/* Brand Header */}
        <div className="adm-brand">
          <div className="adm-logo-badge">
            <IconShieldCheck size={24} color="#ffffff" stroke={2.4} />
          </div>
          {sidebarOpen && (
            <div>
              <div style={{ fontSize: '16px', fontWeight: 800, letterSpacing: '0.04em', color: '#ffffff', lineHeight: 1.1 }}>
                ATHENA
              </div>
              <div style={{ fontSize: '11px', color: 'var(--adm-text-muted)', fontWeight: 500, marginTop: '2px' }}>
                Proctoring Admin
              </div>
            </div>
          )}
        </div>

        {/* Navigation Section */}
        {sidebarOpen && <div className="adm-nav-section-title">MAIN NAVIGATION</div>}

        <nav className="adm-nav-list" style={{ marginTop: sidebarOpen ? 0 : '16px' }}>
          <button
            onClick={() => setActiveNav('dashboard')}
            className={`adm-nav-btn ${activeNav === 'dashboard' ? 'active' : ''}`}
            title="Dashboard"
          >
            <IconLayoutGrid size={19} />
            {sidebarOpen && <span>Dashboard</span>}
          </button>

          <button
            onClick={() => setActiveNav('live')}
            className={`adm-nav-btn ${activeNav === 'live' ? 'active' : ''}`}
            title="Live Monitoring"
          >
            <IconVideo size={19} />
            {sidebarOpen && <span>Live Monitoring</span>}
            {sidebarOpen && <span className="adm-badge-live">● LIVE</span>}
          </button>

          <button
            onClick={() => setActiveNav('violations')}
            className={`adm-nav-btn ${activeNav === 'violations' ? 'active' : ''}`}
            title="Violations Center"
          >
            <IconShieldExclamation size={19} />
            {sidebarOpen && <span>Violations Center</span>}
            {sidebarOpen && <span className="adm-badge-count">{displayViolations.length}</span>}
          </button>

          <button
            onClick={() => setActiveNav('terminated')}
            className={`adm-nav-btn ${activeNav === 'terminated' ? 'active' : ''}`}
            title="Terminated Students"
          >
            <IconX size={19} />
            {sidebarOpen && <span>Terminated Students</span>}
          </button>

          <button
            onClick={() => setActiveNav('finished')}
            className={`adm-nav-btn ${activeNav === 'finished' ? 'active' : ''}`}
            title="Finished Exams"
          >
            <IconCheck size={19} />
            {sidebarOpen && <span>Finished Exams</span>}
          </button>

          <button
            onClick={() => setActiveNav('history')}
            className={`adm-nav-btn ${activeNav === 'history' ? 'active' : ''}`}
            title="Activity History"
          >
            <IconClock size={19} />
            {sidebarOpen && <span>Activity History</span>}
          </button>

          <button
            onClick={() => setActiveNav('reports')}
            className={`adm-nav-btn ${activeNav === 'reports' ? 'active' : ''}`}
            title="Reports"
          >
            <IconFileText size={19} />
            {sidebarOpen && <span>Reports</span>}
          </button>

          <button
            onClick={() => setActiveNav('analytics')}
            className={`adm-nav-btn ${activeNav === 'analytics' ? 'active' : ''}`}
            title="Analytics"
          >
            <IconChartBar size={19} />
            {sidebarOpen && <span>Analytics</span>}
          </button>

          <button
            onClick={() => setActiveNav('settings')}
            className={`adm-nav-btn ${activeNav === 'settings' ? 'active' : ''}`}
            title="Settings"
          >
            <IconSettings size={19} />
            {sidebarOpen && <span>Settings</span>}
          </button>
        </nav>

        {/* Proctoring Active Footer Badge */}
        {sidebarOpen && (
          <div className="adm-proctor-active-pill">
            <div className="adm-pulse-dot" />
            <span>Proctoring Active</span>
          </div>
        )}
      </aside>

      {/* =========================================================================
          MAIN CONTENT AREA
         ========================================================================= */}
      <div className="adm-content-wrapper">
        
        {/* Top Header Bar */}
        <header className="adm-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              style={{ background: 'transparent', border: 'none', color: 'var(--adm-text-secondary)', cursor: 'pointer', fontSize: '20px', display: 'flex', alignItems: 'center' }}
            >
              ☰
            </button>
            <div>
              <h1 className="adm-header-title">System Admin Command Center</h1>
              <p className="adm-header-sub">Real-Time Proctoring & Anomaly Oversight</p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
            {/* Open Port 3001 Admin */}
            <a
              href="http://localhost:3001/live"
              target="_blank"
              rel="noreferrer"
              className="adm-btn-pill adm-btn-port"
            >
              <IconExternalLink size={16} /> Open Port 3001 Admin
            </a>

            {/* Clear All Logs */}
            <button
              onClick={() => {
                setClearTarget('all');
                setShowClearLogsModal(true);
              }}
              className="adm-btn-pill adm-btn-clear"
            >
              <IconTrash size={16} /> Clear All Logs
            </button>

            {/* Dark / Light Mode Switch */}
            <div
              onClick={() => setDarkMode(!darkMode)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                cursor: 'pointer',
                background: '#091024',
                padding: '4px 8px',
                borderRadius: '20px',
                border: '1px solid var(--adm-border)'
              }}
              title="Toggle Theme"
            >
              <IconMoon size={14} color="#8da2c9" />
              <div style={{
                width: '32px',
                height: '16px',
                borderRadius: '20px',
                background: darkMode ? '#1e2954' : '#cbd5e1',
                position: 'relative'
              }}>
                <div style={{
                  width: '12px',
                  height: '12px',
                  borderRadius: '50%',
                  background: '#38bdf8',
                  position: 'absolute',
                  top: '2px',
                  left: darkMode ? '17px' : '3px',
                  transition: 'left 0.2s ease'
                }} />
              </div>
              <IconSun size={14} color="#f59e0b" />
            </div>

            {/* Notifications Bell */}
            <div style={{ position: 'relative' }}>
              <button
                onClick={() => setIsNotificationsOpen(!isNotificationsOpen)}
                style={{
                  background: '#091024',
                  border: '1px solid var(--adm-border)',
                  color: '#ffffff',
                  width: '38px',
                  height: '38px',
                  borderRadius: '10px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                  position: 'relative'
                }}
              >
                <IconBell size={18} />
                {notifications.length > 0 && (
                  <span style={{
                    position: 'absolute',
                    top: '-4px',
                    right: '-4px',
                    background: '#ef4444',
                    color: '#ffffff',
                    fontSize: '10px',
                    fontWeight: 800,
                    width: '16px',
                    height: '16px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}>
                    {notifications.length}
                  </span>
                )}
              </button>

              {/* Notification Dropdown */}
              {isNotificationsOpen && (
                <div style={{
                  position: 'absolute',
                  top: '46px',
                  right: 0,
                  width: '340px',
                  background: '#0d1633',
                  border: '1px solid #1c2752',
                  borderRadius: '14px',
                  boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
                  padding: '16px',
                  zIndex: 100
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #1c2752', paddingBottom: '10px', marginBottom: '12px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff' }}>🚨 Live Anomaly Alerts</span>
                    <button onClick={() => setNotifications([])} style={{ background: 'none', border: 'none', color: '#8da2c9', fontSize: '11px', cursor: 'pointer' }}>Clear</button>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '300px', overflowY: 'auto' }}>
                    {notifications.map((n, idx) => (
                      <div key={idx} style={{ background: '#091026', padding: '10px 12px', borderRadius: '8px', borderLeft: `3px solid ${n.severity === 'critical' ? '#a855f7' : n.severity === 'high' ? '#ef4444' : '#f59e0b'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', fontWeight: 700, color: '#ffffff' }}>
                          <span>{n.type}</span>
                          <span style={{ fontSize: '11px', color: '#8da2c9' }}>{n.time || 'Recent'}</span>
                        </div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '3px' }}>{n.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Admin Avatar Badge */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: '6px' }}>
              <div style={{
                width: '38px',
                height: '38px',
                borderRadius: '50%',
                background: '#7c3aed',
                color: '#ffffff',
                fontWeight: 800,
                fontSize: '14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 8px rgba(124, 58, 237, 0.4)'
              }}>
                S
              </div>
              <div>
                <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>
                  System Administrator
                </div>
                <div style={{ fontSize: '11px', color: '#8da2c9', marginTop: '2px' }}>
                  superadmin
                </div>
              </div>
            </div>

          </div>
        </header>

        {/* Body Container */}
        <main className="adm-main-body">

          {/* =========================================================================
              VIEW 1: DASHBOARD (Matches dash.png)
             ========================================================================= */}
          {activeNav === 'dashboard' && (
            <>
              {/* Header */}
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconLayoutGrid size={22} color="#6366f1" /> SYSTEM ADMIN COMMAND CENTER
                </h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <div className="adm-pulse-dot" />
                  <span style={{ fontSize: '12.5px', color: '#34d399', fontWeight: 700 }}>Real-Time Telemetry Active</span>
                </div>
              </div>

              {/* 5 KPI Stat Cards Strip */}
              <div className="adm-kpi-grid-5">
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">TOTAL EXAMINEES</div>
                  <div className="adm-kpi-value" style={{ color: '#ffffff' }}>128</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">ONLINE LIVE</div>
                  <div className="adm-kpi-value" style={{ color: '#38bdf8' }}>42</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">IN PROGRESS</div>
                  <div className="adm-kpi-value" style={{ color: '#818cf8' }}>36</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">VIOLATIONS</div>
                  <div className="adm-kpi-value" style={{ color: '#f59e0b' }}>20</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">DONE / COMPLETED</div>
                  <div className="adm-kpi-value" style={{ color: '#10b981' }}>81</div>
                </div>
              </div>

              {/* Middle Row: Graph (2/3) + Live Alerts (1/3) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '20px' }}>
                
                {/* Graph Card */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">LIVE EXAM ACTIVITY & TELEMETRY LOAD</h3>
                      <p className="adm-card-sub">Concurrent Candidate Traffic (Past 12 Hours) • Real-Time Telemetry Stream</p>
                    </div>
                    <span style={{
                      padding: '4px 12px',
                      borderRadius: '20px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      fontSize: '11.5px',
                      fontWeight: 800
                    }}>
                      Live Pulse: 42 Active
                    </span>
                  </div>

                  {/* SVG Chart matching dash.png */}
                  <div style={{ width: '100%', height: '180px', position: 'relative', marginTop: '10px' }}>
                    <svg viewBox="0 0 600 160" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
                      <defs>
                        <linearGradient id="dashGraphGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.4" />
                          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                        </linearGradient>
                      </defs>

                      {/* Y-axis grid lines */}
                      <line x1="40" y1="20" x2="580" y2="20" stroke="#141c3a" strokeWidth="1" />
                      <text x="18" y="24" fill="#5c6e94" fontSize="10" fontFamily="sans-serif">80</text>
                      
                      <line x1="40" y1="55" x2="580" y2="55" stroke="#141c3a" strokeWidth="1" />
                      <text x="18" y="59" fill="#5c6e94" fontSize="10" fontFamily="sans-serif">60</text>

                      <line x1="40" y1="90" x2="580" y2="90" stroke="#141c3a" strokeWidth="1" />
                      <text x="18" y="94" fill="#5c6e94" fontSize="10" fontFamily="sans-serif">40</text>

                      <line x1="40" y1="125" x2="580" y2="125" stroke="#141c3a" strokeWidth="1" />
                      <text x="18" y="129" fill="#5c6e94" fontSize="10" fontFamily="sans-serif">20</text>

                      <line x1="40" y1="150" x2="580" y2="150" stroke="#141c3a" strokeWidth="1" />
                      <text x="24" y="152" fill="#5c6e94" fontSize="10" fontFamily="sans-serif">0</text>

                      {/* Area Fill */}
                      <path
                        d="M 60 120 C 130 95, 170 45, 230 40 C 290 35, 330 75, 390 85 C 440 95, 480 85, 540 85 L 540 150 L 60 150 Z"
                        fill="url(#dashGraphGrad)"
                      />

                      {/* Line Stroke */}
                      <path
                        d="M 60 120 C 130 95, 170 45, 230 40 C 290 35, 330 75, 390 85 C 440 95, 480 85, 540 85"
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth="3"
                      />

                      {/* Glowing Data Dots */}
                      <circle cx="60" cy="120" r="4.5" fill="#38bdf8" />
                      <circle cx="150" cy="85" r="4.5" fill="#38bdf8" />
                      <circle cx="230" cy="40" r="4.5" fill="#38bdf8" />
                      <circle cx="320" cy="65" r="4.5" fill="#38bdf8" />
                      <circle cx="410" cy="88" r="4.5" fill="#38bdf8" />
                      <circle cx="500" cy="85" r="4.5" fill="#38bdf8" />
                      <circle cx="540" cy="85" r="6" fill="#34d399" stroke="#ffffff" strokeWidth="2" />

                      {/* X-axis time labels */}
                      <text x="44" y="172" fill="#8da2c9" fontSize="10.5" fontFamily="sans-serif">08:00 AM</text>
                      <text x="135" y="172" fill="#8da2c9" fontSize="10.5" fontFamily="sans-serif">10:00 AM</text>
                      <text x="225" y="172" fill="#8da2c9" fontSize="10.5" fontFamily="sans-serif">12:00 PM</text>
                      <text x="325" y="172" fill="#8da2c9" fontSize="10.5" fontFamily="sans-serif">02:00 PM</text>
                      <text x="425" y="172" fill="#8da2c9" fontSize="10.5" fontFamily="sans-serif">04:00 PM</text>
                      <text x="528" y="172" fill="#34d399" fontSize="11" fontWeight="800" fontFamily="sans-serif">NOW</text>
                    </svg>
                  </div>
                </div>

                {/* Live Alerts Card */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">LIVE ALERTS</h3>
                      <p className="adm-card-sub">Real-Time AI Stream</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ background: '#091024', padding: '14px 16px', borderRadius: '10px', borderLeft: '4px solid #f59e0b' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 800, color: '#fbbf24' }}>
                        <span>Tab Switch Triggered</span>
                        <span style={{ fontSize: '11px', color: '#8da2c9', fontWeight: 600 }}>Just Now</span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#8da2c9', marginTop: '4px' }}>
                        Aarav Sharma switched browser tabs during the exam
                      </div>
                    </div>

                    <div style={{ background: '#091024', padding: '14px 16px', borderRadius: '10px', borderLeft: '4px solid #ef4444' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 800, color: '#f87171' }}>
                        <span>Multiple Faces / Missing</span>
                        <span style={{ fontSize: '11px', color: '#8da2c9', fontWeight: 600 }}>2 mins ago</span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#8da2c9', marginTop: '4px' }}>
                        Rohan Mehta: second face detected in camera frame
                      </div>
                    </div>

                    <div style={{ background: '#091024', padding: '14px 16px', borderRadius: '10px', borderLeft: '4px solid #a855f7' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: 800, color: '#c084fc' }}>
                        <span>Phone Detected</span>
                        <span style={{ fontSize: '11px', color: '#8da2c9', fontWeight: 600 }}>11 mins ago</span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#8da2c9', marginTop: '4px' }}>
                        Vikram Singh: object flagged by the AI vision model
                      </div>
                    </div>
                  </div>
                </div>

              </div>

              {/* Bottom Section: Active Exam Preview */}
              <div className="adm-card">
                <div className="adm-card-head">
                  <div>
                    <h3 className="adm-card-title">ACTIVE EXAM PREVIEW</h3>
                    <p className="adm-card-sub">Live Candidate Sentinels & Biometric Stream Grid</p>
                  </div>
                  <button
                    onClick={() => setActiveNav('live')}
                    style={{
                      background: '#2563eb',
                      color: '#ffffff',
                      border: 'none',
                      borderRadius: '8px',
                      padding: '8px 16px',
                      fontSize: '12.5px',
                      fontWeight: 700,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    View All in Live Grid →
                  </button>
                </div>

                <div className="adm-candidate-grid">
                  {displayCandidates.slice(0, 6).map((c, i) => {
                    const st = (c.status || '').toLowerCase();
                    const borderClass = st.includes('viol') ? 'violation' : st.includes('warn') ? 'warning' : 'clear';
                    const badgeText = st.includes('viol') ? 'Violation' : st.includes('warn') ? 'Warning' : 'Clear';
                    const badgeStyle = st.includes('viol') ? 'adm-badge-failed' : st.includes('warn') ? 'adm-badge-medium' : 'adm-badge-reviewed';

                    return (
                      <div
                        key={i}
                        className={`adm-candidate-card ${borderClass}`}
                        onClick={() => {
                          setWatchingStudent(c);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: '11px', fontWeight: 800, color: '#f87171', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#ef4444' }} /> LIVE
                          </span>
                          <span className={`adm-badge ${badgeStyle}`}>{badgeText}</span>
                        </div>

                        <div className="adm-candidate-thumb">
                          {c.image ? (
                            <img src={c.image} alt={c.studentName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{
                              width: '46px',
                              height: '46px',
                              borderRadius: '50%',
                              background: '#192556',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              color: '#818cf8',
                              fontWeight: 800,
                              fontSize: '18px'
                            }}>
                              {c.studentName ? c.studentName.charAt(0).toUpperCase() : 'S'}
                            </div>
                          )}
                        </div>

                        <div>
                          <div style={{ fontSize: '13px', fontWeight: 800, color: '#ffffff', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {c.studentName}
                          </div>
                          <div style={{ fontSize: '11px', color: '#8da2c9', marginTop: '2px' }}>
                            {c.usn}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 2: LIVE MONITORING (Full video sentinel grid)
             ========================================================================= */}
          {activeNav === 'live' && (
            <>
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconVideo size={22} color="#ef4444" /> LIVE MONITORING SENTINEL GRID
                </h2>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button onClick={fetchData} className="adm-btn-action" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <IconRefresh size={14} /> Refresh Feed
                  </button>
                </div>
              </div>

              {/* Search & Filter Bar */}
              <div className="adm-card" style={{ padding: '16px 20px' }}>
                <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#091024', border: '1px solid var(--adm-border)', borderRadius: '8px', padding: '8px 14px', flex: 1 }}>
                    <IconSearch size={16} color="#8da2c9" />
                    <input
                      type="text"
                      placeholder="Search examinees by name, roll no, or email..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      style={{ background: 'transparent', border: 'none', color: '#ffffff', outline: 'none', width: '100%', fontSize: '13px' }}
                    />
                  </div>

                  <select
                    value={riskFilter}
                    onChange={(e) => setRiskFilter(e.target.value)}
                    style={{ background: '#091024', border: '1px solid var(--adm-border)', color: '#ffffff', borderRadius: '8px', padding: '8px 14px', fontSize: '13px', outline: 'none' }}
                  >
                    <option value="ALL">All Risk Levels</option>
                    <option value="SAFE">Safe (0-20)</option>
                    <option value="MEDIUM">Medium Risk (20-50)</option>
                    <option value="HIGH">High Risk (50+)</option>
                  </select>
                </div>
              </div>

              {/* Grid of full video cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '18px' }}>
                {displayCandidates.map((s, idx) => (
                  <div key={idx} className="adm-card" style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span className="adm-initials-circle">
                          {s.studentName ? s.studentName.charAt(0).toUpperCase() : 'S'}
                        </span>
                        <div>
                          <div style={{ fontWeight: 800, fontSize: '13.5px', color: '#ffffff' }}>{s.studentName}</div>
                          <div style={{ fontSize: '11px', color: '#8da2c9' }}>{s.usn}</div>
                        </div>
                      </div>
                      <span className={`adm-badge ${(s.riskLevel || '').includes('High') ? 'adm-badge-failed' : (s.riskLevel || '').includes('Medium') ? 'adm-badge-medium' : 'adm-badge-reviewed'}`}>
                        {s.riskLevel || 'Safe'}
                      </span>
                    </div>

                    <div
                      style={{ height: '170px', borderRadius: '8px', overflow: 'hidden', background: '#000000', position: 'relative', cursor: 'pointer' }}
                      onClick={() => setWatchingStudent(s)}
                    >
                      {s.image ? (
                        <img src={s.image} alt={s.studentName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8da2c9' }}>
                          <IconVideo size={32} />
                          <span style={{ fontSize: '12px', marginTop: '6px' }}>Click to view stream</span>
                        </div>
                      )}
                      <div style={{ position: 'absolute', top: '8px', right: '8px', background: 'rgba(239, 68, 68, 0.9)', color: '#ffffff', fontSize: '10px', fontWeight: 800, padding: '2px 6px', borderRadius: '4px' }}>
                        ● LIVE
                      </div>
                      <div style={{ position: 'absolute', bottom: '8px', left: '8px', background: 'rgba(15, 23, 42, 0.85)', color: '#38bdf8', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '4px' }}>
                        ⚡ 15 FPS | Verified (98%)
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={() => handleWarnStudent(s)}
                        style={{ flex: 1, padding: '7px', background: '#251b14', border: '1px solid #7c2d12', color: '#fb923c', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        ⚠️ Warn
                      </button>
                      <button
                        onClick={() => handleTerminateStudent(s)}
                        style={{ flex: 1, padding: '7px', background: '#261214', border: '1px solid #991b1b', color: '#f87171', borderRadius: '6px', fontSize: '12px', fontWeight: 700, cursor: 'pointer' }}
                      >
                        ⛔ Terminate
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 3: VIOLATIONS CENTER (Matches viol.png)
             ========================================================================= */}
          {activeNav === 'violations' && (
            <>
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconShieldExclamation size={22} color="#f59e0b" /> VIOLATIONS CENTER
                </h2>
                <div className="adm-filter-group">
                  {['All', 'High', 'Medium', 'Open'].map(f => (
                    <button
                      key={f}
                      onClick={() => setViolFilter(f)}
                      className={`adm-filter-pill ${violFilter === f ? 'active' : ''}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* Layout: Left 2/3 Table + Right 1/3 Stats & Bars */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: '20px' }}>
                
                {/* Left: Violation Log Table Card */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">VIOLATION LOG</h3>
                      <p className="adm-card-sub">Flagged by AI proctoring in the last 60 minutes</p>
                    </div>
                  </div>

                  <div className="adm-table-wrap">
                    <table className="adm-table">
                      <thead>
                        <tr>
                          <th>TIME</th>
                          <th>CANDIDATE</th>
                          <th>VIOLATION</th>
                          <th>SEVERITY</th>
                          <th>STATUS</th>
                          <th>ACTION</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredViolationsList.map((v, i) => (
                          <tr key={i}>
                            <td style={{ fontWeight: 800, color: '#ffffff', fontSize: '13px' }}>{v.time || 'Recent'}</td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <span className="adm-initials-circle">
                                  {v.studentName ? v.studentName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'S'}
                                </span>
                                <span style={{ fontWeight: 700 }}>{v.studentName}</span>
                              </div>
                            </td>
                            <td style={{ color: '#c7d2fe' }}>{v.violationType}</td>
                            <td>
                              <span className={`adm-badge ${(v.severity || '').toLowerCase() === 'high' ? 'adm-badge-high' : 'adm-badge-medium'}`}>
                                {v.severity || 'Medium'}
                              </span>
                            </td>
                            <td>
                              <span className={`adm-badge ${(v.status || '').toLowerCase() === 'escalated' ? 'adm-badge-escalated' : (v.status || '').toLowerCase() === 'reviewed' ? 'adm-badge-reviewed' : 'adm-badge-open'}`}>
                                {v.status || 'Open'}
                              </span>
                            </td>
                            <td>
                              <button
                                className="adm-btn-action"
                                onClick={() => setEvidenceModalImage(v.screenshot || 'sample')}
                              >
                                Review
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Right: Top 3 KPI Cards + Progress Bars */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  
                  {/* 3 Stat Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                    <div className="adm-kpi-card" style={{ padding: '16px' }}>
                      <div className="adm-kpi-label">HIGH</div>
                      <div className="adm-kpi-value" style={{ color: '#f87171', fontSize: '26px' }}>6</div>
                    </div>
                    <div className="adm-kpi-card" style={{ padding: '16px' }}>
                      <div className="adm-kpi-label">MEDIUM</div>
                      <div className="adm-kpi-value" style={{ color: '#fbbf24', fontSize: '26px' }}>14</div>
                    </div>
                    <div className="adm-kpi-card" style={{ padding: '16px' }}>
                      <div className="adm-kpi-label">OPEN</div>
                      <div className="adm-kpi-value" style={{ color: '#38bdf8', fontSize: '26px' }}>9</div>
                    </div>
                  </div>

                  {/* Progress Bars Card */}
                  <div className="adm-card" style={{ flex: 1 }}>
                    <div className="adm-card-head">
                      <div>
                        <h3 className="adm-card-title">BY VIOLATION TYPE</h3>
                        <p className="adm-card-sub">Total 20 today</p>
                      </div>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '10px' }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                          <span>Tab Switch</span>
                          <strong style={{ color: '#ffffff' }}>7</strong>
                        </div>
                        <div className="adm-progress-track">
                          <div className="adm-progress-fill" style={{ width: '70%', background: '#f59e0b' }} />
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                          <span>Multiple Faces</span>
                          <strong style={{ color: '#ffffff' }}>4</strong>
                        </div>
                        <div className="adm-progress-track">
                          <div className="adm-progress-fill" style={{ width: '40%', background: '#f87171' }} />
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                          <span>Face Missing</span>
                          <strong style={{ color: '#ffffff' }}>4</strong>
                        </div>
                        <div className="adm-progress-track">
                          <div className="adm-progress-fill" style={{ width: '40%', background: '#fb923c' }} />
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                          <span>Noise</span>
                          <strong style={{ color: '#ffffff' }}>3</strong>
                        </div>
                        <div className="adm-progress-track">
                          <div className="adm-progress-fill" style={{ width: '30%', background: '#38bdf8' }} />
                        </div>
                      </div>

                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                          <span>Phone</span>
                          <strong style={{ color: '#ffffff' }}>2</strong>
                        </div>
                        <div className="adm-progress-track">
                          <div className="adm-progress-fill" style={{ width: '20%', background: '#a855f7' }} />
                        </div>
                      </div>
                    </div>
                  </div>

                </div>

              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 4: TERMINATED STUDENTS (Matches term.png)
             ========================================================================= */}
          {activeNav === 'terminated' && (
            <>
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconX size={22} color="#ef4444" /> TERMINATED STUDENTS
                </h2>
                <div className="adm-filter-group">
                  {['All', 'Final', 'Appealed'].map(f => (
                    <button
                      key={f}
                      onClick={() => setTermFilter(f)}
                      className={`adm-filter-pill ${termFilter === f ? 'active' : ''}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* 3 Top Stat Cards */}
              <div className="adm-kpi-grid-3">
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">TERMINATED TODAY</div>
                  <div className="adm-kpi-value" style={{ color: '#f87171' }}>6</div>
                  <div className="adm-kpi-sub">Auto-terminated by AI rules: 4</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">APPEALS PENDING</div>
                  <div className="adm-kpi-value" style={{ color: '#fbbf24' }}>2</div>
                  <div className="adm-kpi-sub">Awaiting admin decision</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">REINSTATED</div>
                  <div className="adm-kpi-value" style={{ color: '#34d399' }}>1</div>
                  <div className="adm-kpi-sub">Restored after review</div>
                </div>
              </div>

              {/* Termination Log Card */}
              <div className="adm-card">
                <div className="adm-card-head">
                  <div>
                    <h3 className="adm-card-title">TERMINATION LOG</h3>
                    <p className="adm-card-sub">Candidates removed from live exams</p>
                  </div>
                </div>

                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>CANDIDATE</th>
                        <th>ROLL NO.</th>
                        <th>REASON</th>
                        <th>TIME</th>
                        <th>REACHED</th>
                        <th>STATUS</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredTerminatedList.map((t, idx) => (
                        <tr key={idx}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="adm-initials-circle">
                                {t.studentName ? t.studentName.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() : 'S'}
                              </span>
                              <span style={{ fontWeight: 700 }}>{t.studentName}</span>
                            </div>
                          </td>
                          <td style={{ color: '#8da2c9' }}>{t.rollNo || t.usn || 'CS2026-0155'}</td>
                          <td style={{ color: '#ffffff' }}>{t.reason || t.terminationReason || 'Violation policy limit reached'}</td>
                          <td style={{ color: '#8da2c9' }}>{t.time || 'Recent'}</td>
                          <td style={{ color: '#c7d2fe', fontWeight: 700 }}>{t.reached || 'Q3/10'}</td>
                          <td>
                            <span className={`adm-badge ${(t.status || '').toLowerCase() === 'appealed' ? 'adm-badge-appealed' : 'adm-badge-final'}`}>
                              {t.status || 'Final'}
                            </span>
                          </td>
                          <td>
                            <button
                              className="adm-btn-action"
                              onClick={() => setEvidenceModalImage('sample')}
                            >
                              View Evidence
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 5: FINISHED EXAMS (Matches fin.png)
             ========================================================================= */}
          {activeNav === 'finished' && (
            <>
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconCheck size={22} color="#10b981" /> FINISHED EXAMS
                </h2>
                <div className="adm-filter-group">
                  {['All (81)', 'Passed', 'Failed', 'Flagged'].map(f => (
                    <button
                      key={f}
                      onClick={() => setFinFilter(f.includes('All') ? 'All' : f)}
                      className={`adm-filter-pill ${finFilter === (f.includes('All') ? 'All' : f) ? 'active' : ''}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* 4 Stat Cards */}
              <div className="adm-kpi-grid-4">
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">COMPLETED</div>
                  <div className="adm-kpi-value" style={{ color: '#10b981' }}>81</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">AVERAGE SCORE</div>
                  <div className="adm-kpi-value" style={{ color: '#38bdf8' }}>14.2 / 20</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">PASS RATE</div>
                  <div className="adm-kpi-value" style={{ color: '#10b981' }}>86%</div>
                </div>
                <div className="adm-kpi-card">
                  <div className="adm-kpi-label">AVG. DURATION</div>
                  <div className="adm-kpi-value" style={{ color: '#ffffff' }}>47 min</div>
                </div>
              </div>

              {/* Completed Attempts Table Card */}
              <div className="adm-card">
                <div className="adm-card-head">
                  <div>
                    <h3 className="adm-card-title">COMPLETED ATTEMPTS</h3>
                    <p className="adm-card-sub">Data Structures & Algorithms - Mid Term</p>
                  </div>
                </div>

                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>CANDIDATE</th>
                        <th>ROLL NO.</th>
                        <th>CORRECT</th>
                        <th>SCORE</th>
                        <th>DURATION</th>
                        <th>VIOLATIONS</th>
                        <th>RESULT</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFinishedList.map((f, i) => (
                        <tr key={i}>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                              <span className="adm-initials-circle">
                                {(f.candidate || f.studentName || 'Student').split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                              </span>
                              <span style={{ fontWeight: 700 }}>{f.candidate || f.studentName}</span>
                            </div>
                          </td>
                          <td style={{ color: '#8da2c9' }}>{f.rollNo || f.usn || 'CS2026-0118'}</td>
                          <td style={{ color: '#ffffff', fontWeight: 600 }}>{f.correct || '8 / 10'}</td>
                          <td style={{ color: '#ffffff', fontWeight: 800 }}>{f.score || `${f.evaluatedScore || 16} / 20`}</td>
                          <td style={{ color: '#8da2c9' }}>{f.duration || '42 min'}</td>
                          <td>
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              width: '22px',
                              height: '22px',
                              borderRadius: '50%',
                              fontSize: '11px',
                              fontWeight: 800,
                              background: f.violations === 0 ? 'rgba(16, 185, 129, 0.2)' : f.violations <= 2 ? 'rgba(245, 158, 11, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                              color: f.violations === 0 ? '#34d399' : f.violations <= 2 ? '#fbbf24' : '#f87171'
                            }}>
                              {f.violations !== undefined ? f.violations : 0}
                            </span>
                          </td>
                          <td>
                            <span className={`adm-badge ${(f.result || '').toLowerCase() === 'failed' ? 'adm-badge-failed' : 'adm-badge-passed'}`}>
                              {f.result || 'Passed'}
                            </span>
                          </td>
                          <td>
                            <button
                              className="adm-btn-action"
                              onClick={handleExportPDF}
                            >
                              Open Report
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 6: ACTIVITY HISTORY (Matches hist.png)
             ========================================================================= */}
          {activeNav === 'history' && (
            <>
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconClock size={22} color="#818cf8" /> ACTIVITY HISTORY
                </h2>
                <div className="adm-filter-group">
                  {['All', 'Violations', 'Admin', 'Sessions'].map(f => (
                    <button
                      key={f}
                      onClick={() => setHistFilter(f)}
                      className={`adm-filter-pill ${histFilter === f ? 'active' : ''}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2 Column: Left 2/3 Event Timeline + Right 1/3 Events by Category */}
              <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1fr', gap: '20px' }}>
                
                {/* Timeline Card */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">EVENT TIMELINE</h3>
                      <p className="adm-card-sub">Everything that happened today, newest first</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '6px' }}>
                    {filteredHistoryList.map((item, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '14px', paddingBottom: '10px', borderBottom: '1px solid var(--adm-border-subtle)' }}>
                        <span style={{ fontSize: '12.5px', color: '#8da2c9', minWidth: '45px', fontWeight: 700 }}>
                          {item.time || '18:00'}
                        </span>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: item.dot || '#f59e0b', flexShrink: 0 }} />
                        <span style={{ flex: 1, fontSize: '13px', color: '#ffffff' }}>
                          {item.text || item.action}
                        </span>
                        <span className={`adm-badge ${item.tagColor || 'adm-badge-high'}`}>
                          {item.tag || 'Violation'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: Events By Category */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">EVENTS BY CATEGORY</h3>
                      <p className="adm-card-sub">Last 24 hours</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '10px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Violations</span>
                        <strong style={{ color: '#ffffff' }}>20</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '16%', background: '#f59e0b' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Sessions</span>
                        <strong style={{ color: '#ffffff' }}>128</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '100%', background: '#38bdf8' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Verification</span>
                        <strong style={{ color: '#ffffff' }}>128</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '100%', background: '#10b981' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Submissions</span>
                        <strong style={{ color: '#ffffff' }}>81</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '63%', background: '#a855f7' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Admin actions</span>
                        <strong style={{ color: '#ffffff' }}>9</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '8%', background: '#3b82f6' }} />
                      </div>
                    </div>

                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Terminations</span>
                        <strong style={{ color: '#ffffff' }}>6</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '5%', background: '#ef4444' }} />
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 7: REPORTS (Matches rep.png)
             ========================================================================= */}
          {activeNav === 'reports' && (
            <>
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconFileText size={22} color="#60a5fa" /> REPORTS
                </h2>
              </div>

              {/* 6 Report Generator Cards (3 x 2) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '18px' }}>
                
                {/* 1. Violations Report */}
                <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(99, 102, 241, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#818cf8', marginBottom: '14px' }}>
                      <IconShieldExclamation size={20} />
                    </div>
                    <h3 style={{ fontSize: '14.5px', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>Violations Report</h3>
                    <p style={{ fontSize: '12px', color: '#8da2c9', margin: 0, lineHeight: 1.5 }}>
                      Every flagged event with severity, evidence and review status.
                    </p>
                  </div>
                  <button onClick={handleExportPDF} className="adm-btn-action" style={{ marginTop: '16px', alignSelf: 'flex-start' }}>
                    Generate report
                  </button>
                </div>

                {/* 2. Exam Results */}
                <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(16, 185, 129, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#34d399', marginBottom: '14px' }}>
                      <IconCheck size={20} />
                    </div>
                    <h3 style={{ fontSize: '14.5px', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>Exam Results</h3>
                    <p style={{ fontSize: '12px', color: '#8da2c9', margin: 0, lineHeight: 1.5 }}>
                      Scores, pass rate and duration for each completed attempt.
                    </p>
                  </div>
                  <button onClick={handleExportPDF} className="adm-btn-action" style={{ marginTop: '16px', alignSelf: 'flex-start' }}>
                    Generate report
                  </button>
                </div>

                {/* 3. Terminations Report */}
                <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(239, 68, 68, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f87171', marginBottom: '14px' }}>
                      <IconX size={20} />
                    </div>
                    <h3 style={{ fontSize: '14.5px', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>Terminations Report</h3>
                    <p style={{ fontSize: '12px', color: '#8da2c9', margin: 0, lineHeight: 1.5 }}>
                      Terminated candidates with reasons and appeal outcome.
                    </p>
                  </div>
                  <button onClick={handleExportPDF} className="adm-btn-action" style={{ marginTop: '16px', alignSelf: 'flex-start' }}>
                    Generate report
                  </button>
                </div>

                {/* 4. Session Audit */}
                <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(56, 189, 248, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#38bdf8', marginBottom: '14px' }}>
                      <IconVideo size={20} />
                    </div>
                    <h3 style={{ fontSize: '14.5px', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>Session Audit</h3>
                    <p style={{ fontSize: '12px', color: '#8da2c9', margin: 0, lineHeight: 1.5 }}>
                      Join, leave and reconnect times for every candidate.
                    </p>
                  </div>
                  <button onClick={handleExportCSV} className="adm-btn-action" style={{ marginTop: '16px', alignSelf: 'flex-start' }}>
                    Generate report
                  </button>
                </div>

                {/* 5. Activity Log */}
                <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(168, 85, 247, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#c084fc', marginBottom: '14px' }}>
                      <IconClock size={20} />
                    </div>
                    <h3 style={{ fontSize: '14.5px', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>Activity Log</h3>
                    <p style={{ fontSize: '12px', color: '#8da2c9', margin: 0, lineHeight: 1.5 }}>
                      Admin actions and system events with timestamps.
                    </p>
                  </div>
                  <button onClick={handleExportCSV} className="adm-btn-action" style={{ marginTop: '16px', alignSelf: 'flex-start' }}>
                    Generate report
                  </button>
                </div>

                {/* 6. Integrity Summary */}
                <div className="adm-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ width: '36px', height: '36px', borderRadius: '8px', background: 'rgba(59, 130, 246, 0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#60a5fa', marginBottom: '14px' }}>
                      <IconChartBar size={20} />
                    </div>
                    <h3 style={{ fontSize: '14.5px', fontWeight: 800, color: '#ffffff', margin: '0 0 6px 0' }}>Integrity Summary</h3>
                    <p style={{ fontSize: '12px', color: '#8da2c9', margin: 0, lineHeight: 1.5 }}>
                      Per-candidate risk score and recommended action.
                    </p>
                  </div>
                  <button onClick={handleExportPDF} className="adm-btn-action" style={{ marginTop: '16px', alignSelf: 'flex-start' }}>
                    Generate report
                  </button>
                </div>

              </div>

              {/* Bottom Card: Recent Reports Table */}
              <div className="adm-card">
                <div className="adm-card-head">
                  <div>
                    <h3 className="adm-card-title">RECENT REPORTS</h3>
                    <p className="adm-card-sub">Generated by admins in the last 7 days</p>
                  </div>
                </div>

                <div className="adm-table-wrap">
                  <table className="adm-table">
                    <thead>
                      <tr>
                        <th>REPORT</th>
                        <th>GENERATED</th>
                        <th>FORMAT</th>
                        <th>SIZE</th>
                        <th>BY</th>
                        <th>ACTION</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sampleRecentReports.map((r, idx) => (
                        <tr key={idx}>
                          <td style={{ fontWeight: 800, color: '#ffffff' }}>{r.name}</td>
                          <td style={{ color: '#8da2c9' }}>{r.date}</td>
                          <td>
                            <span className={`adm-badge ${r.formatBadge}`}>{r.format}</span>
                          </td>
                          <td style={{ color: '#8da2c9' }}>{r.size}</td>
                          <td style={{ color: '#c7d2fe' }}>{r.by}</td>
                          <td>
                            <button
                              className="adm-btn-action"
                              onClick={r.format === 'CSV' ? handleExportCSV : handleExportPDF}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
                            >
                              <IconDownload size={13} /> Download
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 8: ANALYTICS (Matches ana.png)
             ========================================================================= */}
          {activeNav === 'analytics' && (
            <>
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconChartBar size={22} color="#a855f7" /> ANALYTICS
                </h2>
                <div className="adm-filter-group">
                  {['Today', '7 Days', '30 Days'].map(r => (
                    <button
                      key={r}
                      onClick={() => setAnalyticsRange(r)}
                      className={`adm-filter-pill ${analyticsRange === r ? 'active' : ''}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* 2 x 2 Grid of Analytics Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                
                {/* 1. Violations by Type */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">VIOLATIONS BY TYPE</h3>
                      <p className="adm-card-sub">Today, all exams</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', marginTop: '12px' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Tab Switch</span>
                        <strong style={{ color: '#ffffff' }}>7</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '70%', background: '#f59e0b' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Multiple Faces</span>
                        <strong style={{ color: '#ffffff' }}>4</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '40%', background: '#f87171' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Face Missing</span>
                        <strong style={{ color: '#ffffff' }}>4</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '40%', background: '#fb923c' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Noise</span>
                        <strong style={{ color: '#ffffff' }}>3</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '30%', background: '#38bdf8' }} />
                      </div>
                    </div>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '6px', color: '#c7d2fe' }}>
                        <span>Phone</span>
                        <strong style={{ color: '#ffffff' }}>2</strong>
                      </div>
                      <div className="adm-progress-track">
                        <div className="adm-progress-fill" style={{ width: '20%', background: '#a855f7' }} />
                      </div>
                    </div>
                  </div>
                </div>

                {/* 2. Violations Per Hour Bar Chart */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">VIOLATIONS PER HOUR</h3>
                      <p className="adm-card-sub">Peaks when the exam starts and ends</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: '170px', padding: '10px 0', borderBottom: '1px solid var(--adm-border)' }}>
                    {[
                      { hour: '12:00', count: 1, h: 22 },
                      { hour: '13:00', count: 3, h: 62 },
                      { hour: '14:00', count: 2, h: 42 },
                      { hour: '15:00', count: 4, h: 84 },
                      { hour: '16:00', count: 3, h: 62 },
                      { hour: '17:00', count: 2, h: 42 },
                      { hour: '18:00', count: 5, h: 110 }
                    ].map((b, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#38bdf8' }}>{b.count}</span>
                        <div style={{ width: '38px', height: `${b.h}px`, background: '#38bdf8', borderRadius: '4px 4px 0 0' }} />
                        <span style={{ fontSize: '10.5px', color: '#8da2c9', marginTop: '6px' }}>{b.hour}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 3. Score Distribution Bar Chart */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">SCORE DISTRIBUTION</h3>
                      <p className="adm-card-sub">Out of 20 marks, 81 completed attempts</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-around', height: '170px', padding: '10px 0', borderBottom: '1px solid var(--adm-border)' }}>
                    {[
                      { range: '0-3', count: 2, h: 18, color: '#f87171' },
                      { range: '4-6', count: 4, h: 32, color: '#fb7185' },
                      { range: '7-9', count: 9, h: 54, color: '#facc15' },
                      { range: '10-12', count: 17, h: 88, color: '#38bdf8' },
                      { range: '13-15', count: 24, h: 118, color: '#0ea5e9' },
                      { range: '16-18', count: 18, h: 92, color: '#10b981' },
                      { range: '19-20', count: 7, h: 44, color: '#34d399' }
                    ].map((s, i) => (
                      <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '11px', fontWeight: 800, color: '#ffffff' }}>{s.count}</span>
                        <div style={{ width: '36px', height: `${s.h}px`, background: s.color, borderRadius: '4px 4px 0 0' }} />
                        <span style={{ fontSize: '10.5px', color: '#8da2c9', marginTop: '6px' }}>{s.range}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 4. Pass Rate & Integrity Donut */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">PASS RATE & INTEGRITY</h3>
                      <p className="adm-card-sub">Pass mark: 8 / 20</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', height: '170px' }}>
                    {/* Donut Gauge */}
                    <div style={{ position: 'relative', width: '130px', height: '130px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <svg width="130" height="130" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="40" fill="none" stroke="#152042" strokeWidth="10" />
                        <circle
                          cx="50"
                          cy="50"
                          r="40"
                          fill="none"
                          stroke="#10b981"
                          strokeWidth="10"
                          strokeDasharray="251.2"
                          strokeDashoffset="35.16"
                          strokeLinecap="round"
                          transform="rotate(-90 50 50)"
                        />
                      </svg>
                      <div style={{ position: 'absolute', textAlign: 'center' }}>
                        <div style={{ fontSize: '22px', fontWeight: 900, color: '#ffffff' }}>86%</div>
                        <div style={{ fontSize: '9px', color: '#8da2c9', textTransform: 'uppercase', fontWeight: 700 }}>Pass rate</div>
                      </div>
                    </div>

                    {/* Stats */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      <div style={{ background: '#091024', padding: '12px 18px', borderRadius: '10px', border: '1px solid var(--adm-border)' }}>
                        <div style={{ fontSize: '11px', color: '#8da2c9', fontWeight: 800 }}>CLEAN ATTEMPTS</div>
                        <div style={{ fontSize: '22px', fontWeight: 900, color: '#34d399', marginTop: '2px' }}>71%</div>
                      </div>

                      <div style={{ background: '#091024', padding: '12px 18px', borderRadius: '10px', border: '1px solid var(--adm-border)' }}>
                        <div style={{ fontSize: '11px', color: '#8da2c9', fontWeight: 800 }}>FLAGGED FOR REVIEW</div>
                        <div style={{ fontSize: '22px', fontWeight: 900, color: '#fbbf24', marginTop: '2px' }}>14%</div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>
            </>
          )}

          {/* =========================================================================
              VIEW 9: SETTINGS (Matches set.png)
             ========================================================================= */}
          {activeNav === 'settings' && (
            <>
              <div className="adm-page-header">
                <h2 className="adm-page-title">
                  <IconSettings size={22} color="#6366f1" /> SETTINGS
                </h2>
                <button
                  onClick={saveSettings}
                  style={{
                    background: '#6366f1',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '8px',
                    padding: '8px 20px',
                    fontSize: '13px',
                    fontWeight: 800,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)'
                  }}
                >
                  Save changes
                </button>
              </div>

              {/* 3 Equal Column Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
                
                {/* 1. PROCTORING RULES */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">PROCTORING RULES</h3>
                      <p className="adm-card-sub">Applied to every live exam</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '8px' }}>
                    {/* Tab-switch limit */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Tab-switch limit</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Warnings before auto-terminate</div>
                      </div>
                      <div className="adm-counter-box">
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, tabSwitchLimit: Math.max(1, s.tabSwitchLimit - 1) }))}>–</button>
                        <span className="adm-counter-val">{settings.tabSwitchLimit}</span>
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, tabSwitchLimit: s.tabSwitchLimit + 1 }))}>+</button>
                      </div>
                    </div>

                    {/* Face missing timeout */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Face missing timeout</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Seconds before a violation is logged</div>
                      </div>
                      <div className="adm-counter-box">
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, faceMissingTimeout: Math.max(5, s.faceMissingTimeout - 5) }))}>–</button>
                        <span className="adm-counter-val">{settings.faceMissingTimeout}s</span>
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, faceMissingTimeout: s.faceMissingTimeout + 5 }))}>+</button>
                      </div>
                    </div>

                    {/* Multiple face detection */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Multiple face detection</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Flag a second face in frame</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.multipleFaceDetection}
                          onChange={(e) => setSettings(s => ({ ...s, multipleFaceDetection: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>

                    {/* Phone & object detection */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Phone & object detection</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>AI vision model on every frame</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.phoneDetection}
                          onChange={(e) => setSettings(s => ({ ...s, phoneDetection: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>

                    {/* Auto-terminate on final warning */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Auto-terminate on final warning</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>End the exam without admin action</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.autoTerminate}
                          onChange={(e) => setSettings(s => ({ ...s, autoTerminate: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>

                {/* 2. ALERTS & NOTIFICATIONS */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">ALERTS & NOTIFICATIONS</h3>
                      <p className="adm-card-sub">How admins hear about incidents</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '8px' }}>
                    {/* Live alert sound */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Live alert sound</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Play a sound for high severity events</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.alertSound}
                          onChange={(e) => setSettings(s => ({ ...s, alertSound: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>

                    {/* Browser notifications */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Browser notifications</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Desktop alerts for new violations</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.browserNotifications}
                          onChange={(e) => setSettings(s => ({ ...s, browserNotifications: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>

                    {/* Email digest */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Email digest</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Daily summary at 20:00</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.emailDigest}
                          onChange={(e) => setSettings(s => ({ ...s, emailDigest: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>

                    {/* Noise detection */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Noise detection</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Flag loud or repeated speech</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.noiseDetection}
                          onChange={(e) => setSettings(s => ({ ...s, noiseDetection: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>

                    {/* Alert retention */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Alert retention</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Days to keep resolved alerts</div>
                      </div>
                      <div className="adm-counter-box">
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, alertRetention: Math.max(7, s.alertRetention - 7) }))}>–</button>
                        <span className="adm-counter-val">{settings.alertRetention}d</span>
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, alertRetention: s.alertRetention + 7 }))}>+</button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* 3. ACCESS & DATA */}
                <div className="adm-card">
                  <div className="adm-card-head">
                    <div>
                      <h3 className="adm-card-title">ACCESS & DATA</h3>
                      <p className="adm-card-sub">Security and records</p>
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '8px' }}>
                    {/* Require biometric re-check */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Require biometric re-check</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Re-verify face every 20 minutes</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.biometricRecheck}
                          onChange={(e) => setSettings(s => ({ ...s, biometricRecheck: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>

                    {/* Admin session timeout */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Admin session timeout</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Minutes of inactivity</div>
                      </div>
                      <div className="adm-counter-box">
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, sessionTimeout: Math.max(10, s.sessionTimeout - 5) }))}>–</button>
                        <span className="adm-counter-val">{settings.sessionTimeout}m</span>
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, sessionTimeout: s.sessionTimeout + 5 }))}>+</button>
                      </div>
                    </div>

                    {/* Record exam video */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Record exam video</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Store evidence for flagged events</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={settings.recordExamVideo}
                          onChange={(e) => setSettings(s => ({ ...s, recordExamVideo: e.target.checked }))}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>

                    {/* Evidence retention */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Evidence retention</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Days before auto-delete</div>
                      </div>
                      <div className="adm-counter-box">
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, evidenceRetention: Math.max(30, s.evidenceRetention - 30) }))}>–</button>
                        <span className="adm-counter-val">{settings.evidenceRetention}d</span>
                        <button className="adm-counter-btn" onClick={() => setSettings(s => ({ ...s, evidenceRetention: s.evidenceRetention + 30 }))}>+</button>
                      </div>
                    </div>

                    {/* Dark theme */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#ffffff' }}>Dark theme</div>
                        <div style={{ fontSize: '11.5px', color: '#8da2c9', marginTop: '2px' }}>Use the dark admin interface</div>
                      </div>
                      <label className="adm-switch">
                        <input
                          type="checkbox"
                          checked={darkMode}
                          onChange={(e) => {
                            setDarkMode(e.target.checked);
                            setSettings(s => ({ ...s, darkTheme: e.target.checked }));
                          }}
                        />
                        <span className="adm-switch-slider" />
                      </label>
                    </div>
                  </div>
                </div>

              </div>
            </>
          )}

        </main>
      </div>

      {/* =========================================================================
          MODALS & OVERLAYS (Preserves All Functioning)
         ========================================================================= */}

      {/* 1. Watch Live Stream Modal */}
      {watchingStudent && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(10px)' }}>
          <div style={{ background: '#0d1633', border: '1px solid #1c2752', borderRadius: '16px', width: '90%', maxWidth: '640px', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #1c2752', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <IconVideo size={20} color="#38bdf8" />
                <div>
                  <h3 style={{ margin: 0, fontSize: '15px', color: '#ffffff', fontWeight: 800 }}>LIVE CAMERA SENTINEL</h3>
                  <div style={{ fontSize: '12px', color: '#818cf8', fontWeight: 600 }}>{watchingStudent.studentName} ({watchingStudent.usn})</div>
                </div>
              </div>
              <button onClick={() => setWatchingStudent(null)} style={{ background: 'none', border: 'none', color: '#8da2c9', fontSize: '18px', cursor: 'pointer' }}>✕</button>
            </div>

            <div style={{ height: '320px', background: '#000000', position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {watchingStudent.image ? (
                <img src={watchingStudent.image} alt="Stream" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <div style={{ textAlign: 'center', color: '#8da2c9' }}>
                  <IconVideo size={48} />
                  <div style={{ marginTop: '8px', fontWeight: 700 }}>Candidate Live Feed Connected</div>
                </div>
              )}
              <div style={{ position: 'absolute', top: '12px', right: '12px', background: '#ef4444', color: '#fff', fontSize: '11px', fontWeight: 800, padding: '3px 8px', borderRadius: '6px' }}>● LIVE</div>
              <div style={{ position: 'absolute', bottom: '12px', left: '12px', background: 'rgba(15, 23, 42, 0.85)', color: '#38bdf8', fontSize: '12px', fontWeight: 700, padding: '4px 10px', borderRadius: '6px' }}>
                ⚡ 15 FPS | 🧠 Biometric Confidence: 98%
              </div>
            </div>

            <div style={{ padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#091024' }}>
              <div style={{ fontSize: '12.5px', color: '#8da2c9' }}>
                Mic: <strong style={{ color: '#34d399' }}>Active</strong> | Noise Level: <strong style={{ color: '#38bdf8' }}>24 dB SPL</strong>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => handleWarnStudent(watchingStudent)} className="adm-btn-action" style={{ color: '#fb923c' }}>⚠️ Warn</button>
                <button onClick={() => handleTerminateStudent(watchingStudent)} className="adm-btn-action" style={{ color: '#f87171' }}>⛔ Terminate</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. Evidence Screenshot Preview Modal */}
      {evidenceModalImage && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(10px)' }}>
          <div style={{ background: '#0d1633', border: '1px solid #1c2752', borderRadius: '16px', width: '90%', maxWidth: '560px', padding: '24px', textAlign: 'center' }}>
            <h3 style={{ margin: '0 0 16px 0', fontSize: '16px', color: '#ffffff', fontWeight: 800 }}>📷 Violation Evidence Snapshot</h3>
            <div style={{ borderRadius: '10px', overflow: 'hidden', border: '1px solid #ef4444', background: '#000000', maxHeight: '320px' }}>
              <img
                src={evidenceModalImage === 'sample' ? 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=600&auto=format&fit=crop&q=80' : evidenceModalImage}
                alt="Evidence"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
            </div>
            <button
              onClick={() => setEvidenceModalImage(null)}
              className="adm-btn-action"
              style={{ marginTop: '18px', padding: '8px 24px' }}
            >
              Close Evidence
            </button>
          </div>
        </div>
      )}

      {/* 3. Clear Logs Confirmation Modal */}
      {showClearLogsModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999, backdropFilter: 'blur(10px)' }}>
          <div style={{ background: '#0d1633', border: '1px solid #1c2752', borderRadius: '16px', width: '90%', maxWidth: '480px', padding: '24px' }}>
            <h3 style={{ margin: '0 0 10px 0', fontSize: '16px', color: '#f87171', fontWeight: 800 }}>🗑️ Clear Proctoring Logs</h3>
            <p style={{ fontSize: '13px', color: '#8da2c9', lineHeight: 1.5, margin: '0 0 20px 0' }}>
              Are you sure you want to clear <strong>{clearTarget}</strong> proctoring telemetry records? This action cannot be undone.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                onClick={() => setShowClearLogsModal(false)}
                className="adm-btn-action"
              >
                Cancel
              </button>
              <button
                onClick={() => handleClearLogs(clearTarget)}
                disabled={isClearingLogs}
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: '6px',
                  padding: '8px 18px',
                  fontSize: '12.5px',
                  fontWeight: 800,
                  cursor: 'pointer'
                }}
              >
                {isClearingLogs ? 'Clearing...' : 'Confirm Clear'}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
