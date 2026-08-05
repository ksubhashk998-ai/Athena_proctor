import React, { useEffect, useState } from 'react';
import { Box, Typography, Grid, Button } from '@mui/material';
import { BookOpen, Users, AlertTriangle, ShieldAlert, CheckCircle2, ArrowRight } from 'lucide-react';
import { adminApi } from '../services/api';
import MetricCard from '../components/common/MetricCard';
import StudentGrid from '../components/live/StudentGrid';
import { useNavigate } from 'react-router-dom';

import useSocket from '../hooks/useSocket';

export const DashboardPage = () => {
  const navigate = useNavigate();
  const { socket } = useSocket();

  const [metrics, setMetrics] = useState({
    activeExams: 0,
    activeStudents: 0,
    violationsToday: 0,
    highRiskStudents: 0,
    examsCompleted: 0
  });

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchDashboardData = async () => {
    try {
      const [analyticsRes, studentsRes] = await Promise.all([
        adminApi.getAnalytics(),
        adminApi.getLiveStudents()
      ]);

      if (analyticsRes.data && analyticsRes.data.success) {
        setMetrics(analyticsRes.data.metrics || {
          activeExams: 0,
          activeStudents: 0,
          violationsToday: 0,
          highRiskStudents: 0,
          examsCompleted: 0
        });
      }

      if (studentsRes.data && studentsRes.data.success) {
        setStudents(studentsRes.data.students || []);
      }
    } catch (error) {
      console.error('Error loading dashboard:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboardData();
    const interval = setInterval(fetchDashboardData, 4000);

    const handleUpdate = (updatedStudent) => {
      if (!updatedStudent) return;
      setStudents((prev) => {
        const id = updatedStudent.studentId || updatedStudent.email || updatedStudent.sessionId;
        const idx = prev.findIndex((s) => (s.studentId || s.email || s.sessionId) === id);
        if (idx !== -1) {
          const next = [...prev];
          next[idx] = { ...next[idx], ...updatedStudent };
          return next;
        }
        return [updatedStudent, ...prev];
      });
    };

    if (socket) {
      socket.on('student-updated', handleUpdate);
      socket.on('student-connected', handleUpdate);
    }

    return () => {
      clearInterval(interval);
      if (socket) {
        socket.off('student-updated', handleUpdate);
        socket.off('student-connected', handleUpdate);
      }
    };
  }, [socket]);

  return (
    <Box>
      {/* Page Title Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            System Dashboard Overview
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Real-time examination monitoring, student telemetries, and proctoring metrics
          </Typography>
        </Box>
        <Button
          variant="contained"
          color="primary"
          endIcon={<ArrowRight size={18} />}
          onClick={() => navigate('/live')}
          sx={{ fontWeight: 700, borderRadius: 2 }}
        >
          View All Live Students
        </Button>
      </Box>

      {/* KPI Cards Grid (Requirement 6) */}
      <Grid container spacing={3} sx={{ mb: 4 }}>
        <Grid item xs={12} sm={6} md={2.4}>
          <MetricCard
            title="Active Exams"
            value={metrics.activeExams}
            subtitle="Running in parallel"
            icon={BookOpen}
            color="#6366f1"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <MetricCard
            title="Active Students"
            value={metrics.activeStudents}
            subtitle="Currently online"
            icon={Users}
            color="#3b82f6"
            trend="+3 active"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <MetricCard
            title="Violations Today"
            value={metrics.violationsToday}
            subtitle="AI Anomaly events"
            icon={AlertTriangle}
            color="#f59e0b"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <MetricCard
            title="High Risk Students"
            value={metrics.highRiskStudents}
            subtitle="Requires proctor action"
            icon={ShieldAlert}
            color="#ef4444"
            trend="Attention"
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <MetricCard
            title="Exams Completed"
            value={metrics.examsCompleted}
            subtitle="Submitted & Verified"
            icon={CheckCircle2}
            color="#10b981"
          />
        </Grid>
      </Grid>

      {/* Live Monitoring Section Preview */}
      <Box sx={{ mb: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" sx={{ fontWeight: 800 }}>
          Live Student Monitoring Grid
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>
          Auto-Refreshing every 10s • Low-latency Socket.IO video stream enabled
        </Typography>
      </Box>

      <StudentGrid students={students} loading={loading} />
    </Box>
  );
};

export default DashboardPage;
