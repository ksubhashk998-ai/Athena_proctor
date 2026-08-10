// Centralized API Base URL configuration for Local Dev and Production (Vercel)
export const getApiBaseUrl = () => {
  const envUrl = process.env.REACT_APP_API_URL || process.env.NEXT_PUBLIC_API_URL;
  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return window.location.origin;
  }
  return 'http://localhost:5000';
};

export const API_BASE_URL = getApiBaseUrl();

// Diagnostics Log per CHECK 2
if (typeof window !== 'undefined') {
  console.log("API URL:", API_BASE_URL);
}

