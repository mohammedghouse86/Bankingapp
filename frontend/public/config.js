// Runtime configuration for the static site. Edit after deployment to point the
// UI at a different API without rebuilding. An empty apiUrl falls back to the
// VITE_API_URL build variable, then to http://localhost:4000.
window.__KESTREL_CONFIG__ = {
  // The GitHub Pages deployment talks to the Render API; local dev uses localhost.
  apiUrl: window.location.hostname.endsWith('github.io') ? 'https://bankingapp-kpp3.onrender.com' : '',
};
