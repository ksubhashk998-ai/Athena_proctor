import React, { useState, useEffect } from 'react';
import { getApiBaseUrl } from '../utils/config';

export default function Diagnostics() {
  const [diagnosticsData, setDiagnosticsData] = useState({
    backendUrl: getApiBaseUrl(),
    mongoDbStatus: 'Checking...',
    mongoDbConnected: false,
    currentUserEmail: 'None',
    studentProfileFound: false,
    embeddingsCount: 0,
    lastVerificationResult: 'None',
    logs: [],
    loading: true,
    error: null
  });

  const runDiagnostics = async () => {
    const apiBase = getApiBaseUrl();
    const storedUserStr = localStorage.getItem('user');
    let email = 'student@proctor.com';
    if (storedUserStr) {
      try {
        const u = JSON.parse(storedUserStr);
        email = u.email || email;
      } catch (e) {}
    }
    const registeredEmail = localStorage.getItem('registered_email') || email;

    let mongoStatus = 'Disconnected';
    let mongoConnected = false;
    let profileFound = false;
    let count = 0;
    let lastResult = 'No recent verification';
    let recentLogs = [];
    let fetchError = null;

    // 1. Health Check GET /api/health
    try {
      const res = await fetch(`${apiBase}/api/health`);
      if (res.ok) {
        const hData = await res.json();
        mongoConnected = !!(hData.mongodb || hData.database === 'connected');
        mongoStatus = mongoConnected ? 'Connected (Online)' : 'Disconnected (Offline)';
      }
    } catch (e) {
      mongoStatus = 'Failed to reach API server';
      fetchError = e.message;
    }

    // 2. Profile Check GET /api/face/status/:email
    try {
      const res = await fetch(`${apiBase}/api/face/status/${encodeURIComponent(registeredEmail)}`);
      if (res.ok) {
        const pData = await res.json();
        profileFound = !!pData.enrolled;
        count = pData.descriptorsCount || 0;
      }
    } catch (e) {}

    // 3. Verification Logs GET /api/face/logs
    try {
      const res = await fetch(`${apiBase}/api/face/logs?limit=5`);
      if (res.ok) {
        const lData = await res.json();
        if (lData.logs && lData.logs.length > 0) {
          recentLogs = lData.logs;
          lastResult = `${lData.logs[0].verificationResult} (${Math.round((lData.logs[0].similarityScore || 0) * 100)}% Cosine Match)`;
        }
      }
    } catch (e) {}

    setDiagnosticsData({
      backendUrl: apiBase,
      mongoDbStatus: mongoStatus,
      mongoDbConnected: mongoConnected,
      currentUserEmail: registeredEmail,
      studentProfileFound: profileFound,
      embeddingsCount: count,
      lastVerificationResult: lastResult,
      logs: recentLogs,
      loading: false,
      error: fetchError
    });
  };

  useEffect(() => {
    runDiagnostics();
  }, []);

  return (
    <div style={{
      minHeight: '100vh',
      backgroundColor: '#0f172a',
      color: '#ffffff',
      fontFamily: 'Inter, system-ui, sans-serif',
      padding: '40px 20px'
    }}>
      <div style={{
        maxWidth: '800px',
        margin: '0 auto',
        background: 'linear-gradient(145deg, #1e293b, #0f172a)',
        border: '1px solid #334155',
        borderRadius: '24px',
        padding: '36px',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
          <div>
            <h1 style={{ fontSize: '1.8rem', fontWeight: 900, color: '#38bdf8', marginBottom: '6px' }}>
              🩺 Athena Proctoring Deployment Diagnostics
            </h1>
            <p style={{ color: '#94a3b8', fontSize: '0.92rem' }}>
              Real-time API connectivity, MongoDB Atlas state, and ArcFace verification diagnostics
            </p>
          </div>
          <button
            onClick={runDiagnostics}
            style={{
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '10px 18px',
              borderRadius: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            🔄 Refresh Status
          </button>
        </div>

        {/* Diagnostics Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginBottom: '28px' }}>
          {/* Card 1: Backend URL */}
          <div style={{ background: 'rgba(30, 41, 59, 0.6)', border: '1px solid #334155', borderRadius: '16px', padding: '20px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '4px' }}>Active Backend URL</div>
            <div style={{ color: '#38bdf8', fontWeight: 700, fontSize: '1rem', wordBreak: 'break-all' }}>
              {diagnosticsData.backendUrl}
            </div>
          </div>

          {/* Card 2: MongoDB Status */}
          <div style={{ background: 'rgba(30, 41, 59, 0.6)', border: '1px solid #334155', borderRadius: '16px', padding: '20px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '4px' }}>MongoDB Database Status</div>
            <div style={{ color: diagnosticsData.mongoDbConnected ? '#34d399' : '#f87171', fontWeight: 800, fontSize: '1.1rem' }}>
              {diagnosticsData.mongoDbConnected ? '🟢 Connected' : '🔴 ' + diagnosticsData.mongoDbStatus}
            </div>
          </div>

          {/* Card 3: Current User */}
          <div style={{ background: 'rgba(30, 41, 59, 0.6)', border: '1px solid #334155', borderRadius: '16px', padding: '20px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '4px' }}>Current Student Email</div>
            <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: '1rem' }}>
              {diagnosticsData.currentUserEmail}
            </div>
          </div>

          {/* Card 4: Enrolled ArcFace Embeddings */}
          <div style={{ background: 'rgba(30, 41, 59, 0.6)', border: '1px solid #334155', borderRadius: '16px', padding: '20px' }}>
            <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '4px' }}>MongoDB ArcFace Embeddings</div>
            <div style={{ color: diagnosticsData.studentProfileFound ? '#34d399' : '#fbbf24', fontWeight: 800, fontSize: '1.1rem' }}>
              {diagnosticsData.studentProfileFound ? `✔ Profile Found (${diagnosticsData.embeddingsCount} frames)` : '⚠️ No Enrollment Found'}
            </div>
          </div>
        </div>

        {/* Last Verification Result Card */}
        <div style={{
          background: 'rgba(15, 23, 42, 0.8)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: '16px',
          padding: '20px',
          marginBottom: '28px'
        }}>
          <div style={{ color: '#94a3b8', fontSize: '0.85rem', marginBottom: '6px' }}>Last Verification Result</div>
          <div style={{ color: '#38bdf8', fontWeight: 800, fontSize: '1.1rem' }}>
            {diagnosticsData.lastVerificationResult}
          </div>
        </div>

        {/* Navigation Actions */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={() => window.location.href = '/register'}
            style={{
              flex: 1,
              background: '#0284c7',
              color: '#ffffff',
              border: 'none',
              padding: '14px',
              borderRadius: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Go to Face Registration ➔
          </button>
          <button
            onClick={() => window.location.href = '/athena-exam'}
            style={{
              flex: 1,
              background: '#10b981',
              color: '#ffffff',
              border: 'none',
              padding: '14px',
              borderRadius: '12px',
              fontWeight: 700,
              cursor: 'pointer'
            }}
          >
            Go to Athena Exam ➔
          </button>
        </div>
      </div>
    </div>
  );
}
