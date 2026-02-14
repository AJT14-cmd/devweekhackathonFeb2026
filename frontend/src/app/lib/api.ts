// Local Flask backend (same origin in dev → Vite proxy to localhost:5000)
export const API_BASE_URL = import.meta.env.VITE_API_URL ?? ''
