import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './styles/theme.css'
import { registerServiceWorker, listenForPushSound } from './lib/pushNotifications'

// Register (doesn't ask permission or subscribe — that only happens
// when the user opts in from Settings) so the worker is ready the
// moment they do.
registerServiceWorker()
listenForPushSound()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
