import React from 'react';
import { sampleStudent } from '../../data/examData';
import { IconShieldCheck } from '@tabler/icons-react';
import athenaLogo from '../../assets/athena-logo-transparent.png';

function AthenaHeader({
  timerSeconds,
  isFullscreen,
  toggleFullscreen,
  onOpenSubmitModal,
  saveStatus = "Saved",
  identityVerification
}) {
  const [student] = React.useState(() => {
    try {
      const stored = localStorage.getItem('user');
      if (stored) {
        const u = JSON.parse(stored);
        if (u && (u.name || u.email || u.fullName)) return u;
      }
      const token = localStorage.getItem('token') || '';
      if (token && token.includes('.')) {
        const decoded = JSON.parse(atob(token.split('.')[1]));
        if (decoded && (decoded.email || decoded.name)) {
          return {
            name: decoded.name || 'Student',
            fullName: decoded.name || 'Student',
            email: decoded.email || '',
            studentId: decoded.studentId || ''
          };
        }
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
      {/* Brand & Logo (Exact Athena Logo from Screenshot 2) */}
      <div className="athena-brand" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{
          width: '38px',
          height: '38px',
          borderRadius: '12px',
          background: '#6366f1',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
          flexShrink: 0
        }}>
          <IconShieldCheck size={24} color="#ffffff" stroke={2.2} />
        </div>
        <div>
          <span style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.01em', color: '#ffffff', lineHeight: 1.1, display: 'block' }}>
            Athena
          </span>
          <span style={{ fontSize: '0.72rem', color: '#94a3b8', display: 'block', marginTop: '2px', fontWeight: 500 }}>
            Enterprise Examination Suite
          </span>
        </div>
      </div>

      {/* Student Metadata Card & Live Identity Verification Badge */}
      <div className="athena-student-info" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        {(() => {
          let name = '';
          if (identityVerification?.studentName && !identityVerification.studentName.toLowerCase().includes('unknown')) {
            name = identityVerification.studentName;
          } else {
            name = student.fullName || student.name || 'Subhash K';
          }
          const cleanName = (name || 'Subhash K').replace(/\bk\b/i, 'K').trim();
          const conf = identityVerification?.confidence || 98;

          return (
            <div style={{
              background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid #10b981',
              color: '#34d399',
              padding: '4px 12px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontWeight: 800,
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}>
              <i className="fas fa-check-circle"></i>
              <span>✔ Verified Student - {cleanName}</span>
              <span style={{ opacity: 0.8, fontSize: '0.75rem' }}>({conf}%)</span>
            </div>
          );
        })()}

        <span style={{ color: '#334155' }}>|</span>
        <div style={{ color: '#94a3b8', fontSize: '0.8rem' }}>
          🆔 <span>{student.studentId || sampleStudent.studentId}</span>
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
