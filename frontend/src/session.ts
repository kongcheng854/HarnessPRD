import { titles, type DocKind, type SessionData } from './types'
import { normalizeFormData } from './utils/structuredFormTransform'

export const SESSION_KEY = 'harnessprd.session.v1'
export const emptySession = (): SessionData => ({
  view: 'form', form: normalizeFormData({}), messages: [], conversationId: '', docs: { prd: '', 'api-docs': '', prompts: '' },
})
export function saveSession(session: SessionData) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}
export function loadSession(): SessionData {
  const initial = emptySession()
  try {
    const raw = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null')
    if (!raw || typeof raw !== 'object') return initial
    initial.form = normalizeFormData(raw.form)
    if (typeof raw.conversationId !== 'string' || !raw.conversationId || !Array.isArray(raw.messages)
      || !raw.messages.length || !raw.messages.every((m: {role?: string; content?: string}) =>
        m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')) return initial
    initial.messages = raw.messages
    if (['ok', 'warn', 'exceed'].includes(raw.contextUsage?.level)) initial.contextUsage = raw.contextUsage
    if (raw.summary && typeof raw.summary === 'object' && !Array.isArray(raw.summary)) initial.summary = raw.summary
    else {
      try {
        const first = JSON.parse(initial.messages[0].content)
        if (first && typeof first.product_name === 'string') initial.summary = first
      } catch { /* 早期会话的首条消息是表单文本。 */ }
    }
    initial.conversationId = raw.conversationId
    initial.view = 'chatting'
    for (const key of Object.keys(titles) as DocKind[]) {
      if (typeof raw.docs?.[key] === 'string') initial.docs[key] = raw.docs[key]
      if (raw.view === 'generating-' + key || raw.view === 'review-' + key) initial.view = `review-${key}`
    }
    if (raw.view === 'done' && Object.values(initial.docs).every(s => s.trim())) initial.view = 'done'
    return initial
  } catch { return initial }
}
export function downloadFile(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
