// ==============================================================================
// WORKNEAR — MASTER BACKEND & CLOUD DEPLOYMENT CONFIGURATION
// ==============================================================================
// Production backend is deployed on Render.
// All API calls go through this URL.
// ==============================================================================

window.WORKNEAR_CONFIG = {
  // ✅ Live Production Backend URL — DO NOT CHANGE
  API_URL: 'https://work-near.onrender.com',

  // Local Wi-Fi IP address (for Android WebView / physical device testing only)
  // Leave API_URL set above; this is only used as a fallback if API_URL is blank.
  BACKEND_IP: '',
  PORT: '8000'
};
