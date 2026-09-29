// Centralized API Base URL configuration for Local Dev and Production (Vercel)
export const getApiBaseUrl = () => {
  let envUrl = '';

  try {
    // Check Vite / Webpack / CRA environment variables
    if (typeof import.meta !== 'undefined' && import.meta?.env?.VITE_API_URL) {
      envUrl = import.meta.env.VITE_API_URL;
    }
  } catch (e) {}

  if (!envUrl && typeof process !== 'undefined' && process.env) {
    envUrl = 
      process.env.VITE_API_URL || 
      process.env.REACT_APP_API_URL || 
      process.env.NEXT_PUBLIC_API_URL || 
      process.env.REACT_APP_BACKEND_URL;
  }

  if (envUrl) {
    return envUrl.replace(/\/$/, '');
  }

  // When deployed on Vercel or any cloud domain, default directly to Render backend
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    return 'https://athena-proctor-8.onrender.com';
  }

  return 'http://localhost:5000';
};

export const API_BASE_URL = getApiBaseUrl();

// Diagnostics Log per CHECK 2
if (typeof window !== 'undefined') {
  console.log("API URL:", API_BASE_URL);
}

