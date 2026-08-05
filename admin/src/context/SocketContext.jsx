import React, { createContext, useContext, useEffect, useState } from 'react';
import socketService from '../services/socketService';

const SocketContext = createContext(null);

export const SocketProvider = ({ children }) => {
  const [socket, setSocket] = useState(null);
  const [activeAlert, setActiveAlert] = useState(null);
  const [alertsList, setAlertsList] = useState([]);
  const [liveStreamFrame, setLiveStreamFrame] = useState({});

  useEffect(() => {
    const socketInstance = socketService.connect();
    setSocket(socketInstance);

    // Socket.IO event handlers
    const handleAIAlert = (alertData) => {
      console.log('🔔 AI Alert received:', alertData);
      setActiveAlert({
        id: Date.now(),
        type: alertData.alertType || alertData.type || 'AI_ALERT',
        message: alertData.message || alertData.description || 'Suspicious activity detected',
        studentName: alertData.studentName || 'Student',
        studentId: alertData.studentId,
        timestamp: new Date().toLocaleTimeString()
      });

      setAlertsList((prev) => [
        {
          id: Date.now(),
          ...alertData,
          timestamp: new Date()
        },
        ...prev.slice(0, 49)
      ]);
    };

    const handleViolation = (violationData) => {
      console.log('⚠️ Violation received:', violationData);
      setActiveAlert({
        id: Date.now(),
        type: violationData.type || 'VIOLATION',
        message: violationData.description || 'Violation recorded',
        studentName: violationData.studentName || 'Student',
        studentId: violationData.studentId,
        timestamp: new Date().toLocaleTimeString()
      });
    };

    const handleVideoStream = (frameData) => {
      if (frameData && (frameData.studentId || frameData.sessionId || frameData.email)) {
        const img = frameData.image || frameData.frame;
        setLiveStreamFrame((prev) => ({
          ...prev,
          ...(frameData.studentId ? { [frameData.studentId]: img } : {}),
          ...(frameData.sessionId ? { [frameData.sessionId]: img } : {}),
          ...(frameData.email ? { [frameData.email]: img } : {})
        }));
      }
    };

    socketService.on('ai-alert', handleAIAlert);
    socketService.on('violation', handleViolation);
    socketService.on('video-stream', handleVideoStream);

    return () => {
      socketService.off('ai-alert', handleAIAlert);
      socketService.off('violation', handleViolation);
      socketService.off('video-stream', handleVideoStream);
    };
  }, []);

  const dismissAlert = () => {
    setActiveAlert(null);
  };

  return (
    <SocketContext.Provider
      value={{
        socket,
        activeAlert,
        alertsList,
        liveStreamFrame,
        dismissAlert
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = () => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};
