import { createRoot } from 'react-dom/client'
import App from './App'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import SessionWorkspace from './SessionWorkspace'
import SessionList from './SessionList'
import './index.css'

createRoot(document.getElementById('root')!).render(<BrowserRouter><Routes>
  <Route path="/" element={<App />}/>
  <Route path="/index.html" element={<App />}/>
  <Route path="/v2/list" element={<SessionList />}/>
  <Route path="/v2/:id?" element={<SessionWorkspace />}/>
</Routes></BrowserRouter>)
