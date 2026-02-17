import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:5000', ws: true },
      '/auth': { target: 'http://localhost:5000' },
      '/health': { target: 'http://localhost:5000' },
      '/meetings': { target: 'http://localhost:5000' },
      '/uploads': { target: 'http://localhost:5000' },
    },
  },
})
