import React from 'react';
import { sampleStudent } from '../../data/examData';

function AthenaHeader({
  timerSeconds,
  isFullscreen,
  toggleFullscreen,
  onOpenSubmitModal,
  saveStatus = "Saved"
}) {
  const [student] = React.useState(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u && (u.name || u.email)) return u;
      }
    } catch (e) {}
    return sampleStudent;
  });

  // Format seconds to HH:MM:SS
  const formatTime = (secs) => {
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = secs % 60;
    const pad = (num) => num.toString().padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  const isLowTime = timerSeconds < 300; // < 5 minutes
  const isWarnTime = timerSeconds < 900; // < 15 minutes

  return (
    <header className="athena-header">
      {/* Brand & Logo */}
      <div className="athena-brand">
        <div className="athena-brand-logo">
          <i className="fas fa-shield-halved"></i>
        </div>
        <div>
          <h1 className="athena-brand-title">Athena AI Proctoring</h1>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '-2px' }}>
            Enterprise Examination Suite
          </span>
        </div>
      </div>

      {/* Student Metadata Card */}
      <div className="athena-student-info">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i className="fas fa-user-circle" style={{ color: '#818cf8', fontSize: '1rem' }}></i>
          <span><strong>{student.name || (student.email ? student.email.split('@')[0] : sampleStudent.name)}</strong></span>
        </div>
        <span style={{ color: '#334155' }}>|</span>
        <div style={{ color: '#94a3b8' }}>
          🆔 <span>{student.studentId || sampleStudent.studentId}</span>
        </div>
        <span style={{ color: '#334155' }}>|</span>
        <div style={{ color: '#94a3b8' }}>
          📚 <span>{student.course || sampleStudent.course}</span>
        </div>
      </div>

      {/* Right Controls: Timer, Fullscreen, Save Status & Submit */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        {/* Auto-save status */}
        <div style={{ fontSize: '0.78rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <i className="fas fa-check-circle"></i>
          <span>{saveStatus}</span>
        </div>

        {/* Live Exam Countdown Timer */}
        <div className="athena-timer-card">
          <i className="far fa-clock" style={{ color: '#60a5fa', fontSize: '0.9rem' }}></i>
          <span className={`athena-timer-digit ${isLowTime ? 'danger' : isWarnTime ? 'warning' : ''}`}>
            {formatTime(timerSeconds)}
          </span>
        </div>

        {/* Fullscreen Toggle */}
        <button
          onClick={toggleFullscreen}
          style={{
            background: '#1e293b',
            border: '1px solid #334155',
            color: '#cbd5e1',
            padding: '8px 14px',
            borderRadius: '20px',
            fontSize: '0.82rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.2s ease'
          }}
        >
          <i className={`fas ${isFullscreen ? 'fa-compress' : 'fa-expand'}`}></i>
          <span>{isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}</span>
        </button>

        {/* Final Submit Button */}
        <button
          onClick={onOpenSubmitModal}
          style={{
            background: 'linear-gradient(135deg, #10b981, #059669)',
            border: 'none',
            color: 'white',
            padding: '8px 18px',
            borderRadius: '20px',
            fontSize: '0.85rem',
            fontWeight: 700,
            cursor: 'pointer',
            boxShadow: '0 0 12px rgba(16, 185, 129, 0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            transition: 'transform 0.15s ease'
          }}
        >
          <i className="fas fa-flag-checkered"></i>
          <span>Submit Exam</span>
        </button>
      </div>
    </header>
  );
}

export default AthenaHeader;
