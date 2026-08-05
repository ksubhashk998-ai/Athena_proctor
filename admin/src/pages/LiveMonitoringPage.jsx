import React, { useEffect, useState } from 'react';
import { Box, Typography, Button } from '@mui/material';
import { RefreshCw } from 'lucide-react';
import { adminApi } from '../services/api';
import StudentGrid from '../components/live/StudentGrid';

import useSocket from '../hooks/useSocket';

export const LiveMonitoringPage = () => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const { socket } = useSocket();

  const fetchLiveStudents = async () => {
    try {
      const response = await adminApi.getLiveStudents();
      if (response.data && response.data.success) {
        setStudents(response.data.students);
      }
    } catch (error) {
      console.error('Error fetching live students:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLiveStudents();
    const interval = setInterval(fetchLiveStudents, 4000);

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
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography variant="h4" sx={{ fontWeight: 800, letterSpacing: '-0.02em' }}>
            Live Student Exam Monitoring
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Real-time webcams, head pose, eye gaze, tab switches, and AI detection feeds
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<RefreshCw size={16} />}
          onClick={fetchLiveStudents}
          sx={{ fontWeight: 700, borderRadius: 2 }}
        >
          Refresh Feed
        </Button>
      </Box>

      {/* Main Student Grid */}
      <StudentGrid students={students} loading={loading} />
    </Box>
  );
};

export default LiveMonitoringPage;
