import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { store, bootstrap } from './store'
import App from './App'
import 'antd/dist/reset.css'
import 'highlight.js/styles/vs2015.css'
import '@xterm/xterm/css/xterm.css'
import './styles.css'

// Exposed for debugging in the browser console (state inspection, dispatching).
window.__store = store

async function start() {
  try {
    await bootstrap()
  } catch (err) {
    console.error('bootstrap failed', err)
  }
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <Provider store={store}>
        <App />
      </Provider>
    </React.StrictMode>
  )
}

start()
