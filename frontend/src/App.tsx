import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, Download, FileText, Layers3, LoaderCircle } from 'lucide-react'
import { STEPS, titles, type DocKind, type QuestionsConfig, type SessionData } from './types'
import * as api from './services/api'
import { downloadFile, emptySession, loadSession, saveSession } from './session'
import FormStep from './components/FormStep'
import ChatInput from './components/ChatInput'
import MessageList from './components/MessageList'
import DocumentReview from './components/DocumentReview'

const kinds: DocKind[] = ['prd', 'api-docs', 'prompts']
export default function App() {
  const [session, setSession] = useState(loadSession)
  const [questions, setQuestions] = useState<QuestionsConfig>()
  const [attempt, setAttempt] = useState(0)
  const [configError, setConfigError] = useState(false)
  const [error, setError] = useState('')
  const [saveError, setSaveError] = useState(false)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const [streaming, setStreaming] = useState('')
  const [pending, setPending] = useState('')
  const { view, docs, form, messages, conversationId } = session
  const kind = kinds.find(k => view === 'review-' + k || view === 'generating-' + k)
  const step = view === 'done' ? 5 : kind ? kinds.indexOf(kind) + 2 : view === 'chatting' ? 1 : 0
  useEffect(() => {
    let active = true
    setConfigError(false)
    api.getQuestions().then(q => { if (active) setQuestions(q) }).catch(() => { if (active) setConfigError(true) })
    return () => { active = false }
  }, [attempt])
  useEffect(() => {
    try { saveSession(session); setSaveError(false) } catch { setSaveError(true) }
  }, [session])
  function patch(data: Partial<SessionData>) { setSession(s => ({ ...s, ...data })) }
  function edit(key: DocKind, content: string) {
    setSession(s => ({ ...s, docs: { ...s.docs, [key]: content } }))
  }
  async function run(task: () => Promise<void>, recover: () => void) {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setStreaming('')
    setError('')
    try { await task(); return true }
    catch (e) { recover(); setError(e instanceof Error ? e.message : '请求失败，请重试。'); return false }
    finally { lock.current = false; setBusy(false); setStreaming(''); setPending('') }
  }
  function chat(text?: string) {
    return run(async () => {
      patch({ view: 'chatting' })
      setPending(text || '')
      const chunk = (part: string) => setStreaming(s => s + part)
      const result = text ? await api.continueConversationStream(conversationId, messages, text, chunk)
        : await api.startConversationStream(form, chunk)
      if (!result.conversation_id || !result.messages?.length) throw new Error('对话记录接收不完整，请重试。')
      patch({ conversationId: result.conversation_id, messages: result.messages })
    }, () => patch({ view: text ? 'chatting' : 'form' }))
  }
  function generate(key: DocKind, instruction?: string) {
    return run(async () => {
      patch({ view: `generating-${key}` })
      let content = ''
      const chunk = (part: string) => { content += part; setStreaming(content) }
      if (instruction) await api.optimizeDocumentStream(key, docs[key], instruction, chunk)
      else if (key === 'prd') await api.generatePrdStream(messages, chunk)
      else if (key === 'api-docs') await api.generateApiDocsStream(docs.prd, chunk)
      else await api.generatePromptsStream(docs.prd, chunk)
      if (!content.trim()) throw new Error('文档为空，请重试。')
      setSession(s => ({ ...s, docs: { ...s.docs, [key]: content }, view: `review-${key}` }))
    }, () => patch({ view: `review-${key}` }))
  }
  const next = kind && kinds[kinds.indexOf(kind) + 1]
  const heading = kind ? titles[kind] : view === 'done' ? '文档已就绪' : view === 'chatting' ? '需求访谈' : '描述你的产品'
  return <div className="app">
    <header><div className="brand"><span className="logo"><Layers3 size={21}/></span>Harness<span>PRD</span></div>
      <span className="workspace">产品工作台</span></header>
    <div className="layout"><aside><h2>项目流程</h2><ol>{STEPS.map((s,i) =>
      <li key={s.id} className={i === step ? 'active' : i < step ? 'complete' : ''} aria-current={i === step ? 'step' : undefined}>
        <span>{i < step ? <Check size={14}/> : i + 1}</span>{s.label}</li>)}</ol></aside>
    <main><div className="eyebrow">{form.product || '新建项目'}</div><h1>{heading}</h1>
    {view === 'form' && <p className="lead">填写产品构想，AI 产品经理将据此与你梳理需求。</p>}
    {error && <div className="alert" role="alert">{error}</div>}
    {saveError && <div className="alert" role="status">浏览器无法保存本次进度，请在关闭前下载文档。</div>}
    {view === 'form' && (questions ? <FormStep questions={questions} values={form}
      onChange={(name,value) => setSession(s => ({ ...s, form: { ...s.form, [name]: value } }))} onSubmit={() => void chat()}/> :
      <div className="panel">{configError ? <>表单加载失败，请检查后端连接。 <button onClick={() => setAttempt(n => n+1)}>重试</button></> : '正在加载表单…'}</div>)}
    {view === 'chatting' && <section className="panel"><MessageList messages={pending ? [...messages, { role: 'user', content: pending }] : messages} streaming={streaming}/>
      {busy && <small className="status" role="status"><LoaderCircle className="animate-spin" size={14}/> 正在回复</small>}
      <ChatInput disabled={busy} onSend={chat}/>
      {!busy && messages.some(m => m.role === 'assistant') && <footer><button className="primary" onClick={() => generate('prd')}>生成 PRD <ArrowRight size={16}/></button></footer>}
    </section>}
    {kind && <DocumentReview key={kind} title={titles[kind]} content={docs[kind]} streaming={streaming} busy={busy}
      onEdit={content => edit(kind, content)} onOptimize={instruction => generate(kind, instruction)} actions={<>
        {!docs[kind].trim() && <button disabled={busy} onClick={() => generate(kind)}>重新生成</button>}
        <button className="primary" disabled={busy || !docs[kind].trim()} onClick={() => next ? generate(next) : patch({ view: 'done' })}>
          {next ? '生成' + titles[next] : '完成并下载'} <ArrowRight size={16}/></button></>}/>}
    {view === 'done' && <section className="panel">{kinds.map(k => <div className="file" key={k}><FileText/>
      <div><h2>{titles[k]}</h2><small>{k}.md</small></div><button onClick={() => downloadFile(k + '.md', docs[k])}><Download size={16}/>下载</button></div>)}
      <footer><button onClick={() => { setSession(emptySession()); setError('') }}>重新开始</button></footer></section>}
    </main></div></div>
}
