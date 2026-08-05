/**
 * socketService.js - Socket.IO client singleton
 */
import { io } from 'socket.io-client';

let socket = null;

export function getSocket() {
    if (!socket) {
        socket = io('http://localhost:5000', {
            transports: ['websocket', 'polling'],
            autoConnect: true,
        });

        socket.on('connect', () => console.log('🔌 Socket.IO connected:', socket.id));
        socket.on('disconnect', () => console.log('🔌 Socket.IO disconnected'));
        socket.on('connect_error', (err) => console.warn('Socket connect error:', err.message));
    }
    return socket;
}

export function joinStudentRoom(studentId) {
    const s = getSocket();
    s.emit('join_student', studentId);
}

export function joinTeacherRoom() {
    const s = getSocket();
    s.emit('join_teacher');
}

export function disconnectSocket() {
    if (socket) {
        socket.disconnect();
        socket = null;
    }
}
