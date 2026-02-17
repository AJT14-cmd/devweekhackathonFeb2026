import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './app/App'
import { AuthProvider } from './app/contexts/AuthContext'
import { ErrorBoundary } from './app/components/ErrorBoundary'
import './styles/index.css'

const rootEl = document.getElementById('root')
if (!rootEl) {
  document.body.innerHTML = '<div style="padding:24px;font-family:system-ui">Root element #root not found.</div>'
} else {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}
