import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add Authorization header token to request if present
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('adminToken');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('adminToken');
      localStorage.removeItem('adminData');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

// API Endpoints
export const adminApi = {
  // Admin Login
  login: (credentials) => api.post('/admin/login', credentials),

  // Live Student Monitoring
  getLiveStudents: (params) => api.get('/admin/students/live', { params }),

  // Student Detail Page
  getStudentDetail: (id) => api.get(`/admin/student/${id}`),

  // Reports
  getReports: (params) => api.get('/admin/reports', { params }),

  // Analytics
  getAnalytics: () => api.get('/admin/analytics'),

  // Alerts
  getAlerts: () => api.get('/admin/alerts')
};

export default api;
