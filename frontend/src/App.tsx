import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import axios from 'axios'
import { ArrowRight, Check, Download, FileText, Layers3, LoaderCircle } from 'lucide-react'
import { STEPS, titles, type DocKind, type PendingReview, type RequirementsSchema, type RequirementsSummary, type SessionData } from './types'
import * as api from './services/api'
import { downloadFile, emptySession, loadSession, saveSession } from './session'
import AppV2, { CLARIFICATION_SYSTEM_PROMPT } from './AppV2'
import SummaryDiffPanel from './components/SummaryDiffPanel'
import ChatInput from './components/ChatInput'
import MessageList from './components/MessageList'
import DocumentReview from './components/DocumentReview'

const kinds: DocKind[] = ['prd', 'api-docs', 'prompts']
type Review = { type: 'loading'; label: string } | PendingReview
export default function App() {
  const [session, setSession] = useState(loadSession)
  const [saveError, setSaveError] = useState(false)
  useEffect(() => {
    try { saveSession(session); setSaveError(false) } catch { setSaveError(true) }
  }, [session])
  return <Workbench session={session} setSession={setSession} saveError={saveError}/>
}

interface WorkspaceActions {
  ensureSaved: () => Promise<boolean>
  leave: (destination: 'list' | 'new') => Promise<void>
}

export function Workbench({ session, setSession, actions, saveError }: {
  session: SessionData
  setSession: Dispatch<SetStateAction<SessionData>>
  actions?: WorkspaceActions
  saveError?: boolean
}) {
  const [schema, setSchema] = useState<RequirementsSchema>()
  const [attempt, setAttempt] = useState(0)
  const [configError, setConfigError] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loadingReview, setLoadingReview] = useState<Extract<Review, {type: 'loading'}> | null>(null)
  const review = loadingReview ?? session.review
  const lock = useRef(false)
  const [streaming, setStreaming] = useState('')
  const [pending, setPending] = useState('')
  const { view, docs, form, messages, conversationId } = session
  const kind = kinds.find(k => view === 'review-' + k || view === 'generating-' + k)
  const step = view === 'done' ? 5 : kind ? kinds.indexOf(kind) + 2 : view === 'chatting' ? 1 : 0
  useEffect(() => {
    let active = true
    setConfigError(false)
    api.getRequirementsSchema().then(data => { if (active) setSchema(data) }).catch(() => { if (active) setConfigError(true) })
    return () => { active = false }
  }, [attempt])
  function patch(data: Partial<SessionData>) { setSession(s => ({ ...s, ...data })) }
  function setReview(value: Review | null) {
    setLoadingReview(value?.type === 'loading' ? value : null)
    patch({review: value && value.type !== 'loading' ? value : undefined})
  }
  function edit(key: DocKind, content: string) {
    setSession(s => ({ ...s, docs: { ...s.docs, [key]: content } }))
  }
  async function run(task: () => Promise<void>, recover: () => void) {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setStreaming('')
    setError('')
    try {
      if (actions && !await actions.ensureSaved()) {
        setError('方案尚未保存，请稍后重试。')
        return false
      }
      await task()
      return true
    }
    catch (e) {
      recover()
      const detail = axios.isAxiosError(e) && e.response?.data?.detail
      setError(typeof detail === 'string' ? detail : e instanceof Error ? e.message : '请求失败，请重试。')
      return false
    }
    finally { lock.current = false; setBusy(false); setStreaming(''); setPending('') }
  }
  function chat(input: string | RequirementsSummary) {
    return run(async () => {
      patch({ view: 'chatting' })
      setPending(typeof input === 'string' ? input : '')
      const chunk = (part: string) => setStreaming(s => s + part)
      const result = typeof input === 'string' ? await api.continueConversationStream(conversationId, messages, input, chunk, CLARIFICATION_SYSTEM_PROMPT)
        : await api.startSummaryStream(input, chunk, CLARIFICATION_SYSTEM_PROMPT)
      if (!result.conversation_id || !result.messages?.length) throw new Error('对话记录接收不完整，请重试。')
      patch({ conversationId: result.conversation_id, messages: result.messages, summary: typeof input === 'string' ? session.summary : input })
    }, () => patch({ view: typeof input === 'string' ? 'chatting' : 'form' }))
  }
  function prepareDocument(key: DocKind) {
    if (key === 'prompts') return generate(key)
    return run(async () => {
      if (key === 'prd') {
        setReview({type: 'loading', label: '正在核对访谈与需求摘要…'})
        setReview({type: 'summary', candidate: await api.syncSummary(session.summary ?? {}, messages)})
      } else {
        setReview({type: 'loading', label: '正在检索相关接口资料…'})
        setReview({type: 'references', hits: await api.retrieveApiDocs(docs.prd, messages)})
      }
    }, () => setReview(null))
  }
  function generate(key: DocKind, instruction?: string, approved?: Extract<Review, {type: 'summary' | 'references'}>) {
    return run(async () => {
      setReview(null)
      patch({ view: `generating-${key}`, summary: approved?.type === 'summary' ? approved.candidate : session.summary })
      let content = ''
      const chunk = (part: string) => { content += part; setStreaming(content) }
      if (instruction) await api.optimizeDocumentStream(key, docs[key], instruction, chunk)
      else if (key === 'prd' && approved?.type === 'summary') await api.generatePrdStream(messages, chunk, approved.candidate)
      else if (key === 'api-docs' && approved?.type === 'references') await api.generateApiDocsStream(docs.prd, chunk, approved.hits)
      else if (key === 'prompts') await api.generatePromptsStream(docs.prd, chunk)
      else throw new Error('请先确认生成资料。')
      if (!content.trim()) throw new Error('文档为空，请重试。')
      setSession(s => ({ ...s, docs: { ...s.docs, [key]: content }, view: `review-${key}` }))
    }, () => patch({ view: `review-${key}` }))
  }
  const next = kind && kinds[kinds.indexOf(kind) + 1]
  const heading = kind ? titles[kind] : view === 'done' ? '文档已就绪' : view === 'chatting' ? '需求访谈' : '描述你的产品'
  return <div className="app">
    <header><div className="brand"><span className="logo"><Layers3 size={21}/></span>Harness<span>PRD</span></div>
      <span className="workspace">产品工作台</span>
      {actions && <nav className="workspace-nav">
        <button disabled={busy} onClick={() => actions.leave('list')}>我的方案</button>
        <button disabled={busy} onClick={() => actions.leave('new')}>结束当前任务</button>
        <button disabled={busy} onClick={() => actions.leave('new')}>新建</button>
      </nav>}</header>
    <div className="layout"><aside><h2>项目流程</h2><ol>{STEPS.map((s,i) =>
      <li key={s.id} className={i === step ? 'active' : i < step ? 'complete' : ''} aria-current={i === step ? 'step' : undefined}>
        <span>{i < step ? <Check size={14}/> : i + 1}</span>{s.label}</li>)}</ol></aside>
    <main><div className="eyebrow">{String(session.summary?.product_name || form.product_name || '新建项目')}</div><h1>{heading}</h1>
    {view === 'form' && <p className="lead">{session.entryMode === 'prd' ? '粘贴已有的 Markdown PRD，继续审核并生成接口文档。' : '填写产品构想，AI 产品经理将据此与你梳理需求。'}</p>}
    {error && <div className="alert" role="alert">{error}</div>}
    {saveError && <div className="alert" role="status">浏览器无法保存本次进度，请在关闭前下载文档。</div>}
    {view === 'form' && actions && <div className="flex gap-2 mb-4">
      <button disabled={busy} aria-pressed={session.entryMode !== 'prd'} onClick={() => patch({entryMode: 'form'})}>填写产品需求</button>
      <button disabled={busy} aria-pressed={session.entryMode === 'prd'} onClick={() => patch({entryMode: 'prd'})}>从已有 PRD 开始</button>
    </div>}
    {view === 'form' && session.entryMode === 'prd' && <section className="panel"><label htmlFor="import-prd">PRD 正文</label>
      <textarea id="import-prd" rows={12} disabled={busy} value={docs.prd} onChange={e => edit('prd', e.target.value)}/>
      <footer><button className="primary" disabled={busy || !docs.prd.trim()} onClick={() => run(async () => patch({view: 'review-prd'}), () => {})}>进入 PRD 审核</button></footer>
    </section>}
    {view === 'form' && session.entryMode !== 'prd' && (schema ? <fieldset disabled={busy}><AppV2 schema={schema} values={form}
      onChange={(name,value) => setSession(s => ({ ...s, form: { ...s.form, [name]: value } }))} onSubmit={chat}/></fieldset> :
      <div className="panel">{configError ? <>表单加载失败，请检查后端连接。 <button onClick={() => setAttempt(n => n+1)}>重试</button></> : '正在加载表单…'}</div>)}
    {review?.type === 'loading' && <div className="panel" role="status">{review.label}</div>}
    {review?.type === 'summary' && <SummaryDiffPanel before={session.summary ?? {}} after={review.candidate}
      onReject={() => setReview(null)} onConfirm={() => generate('prd', undefined, review)}/>}
    {review?.type === 'references' && <section className="panel"><h2>确认接口参考资料</h2>
      {review.hits.length ? review.hits.map(hit => <article className="rag-hit" key={hit.source}><h3>{hit.title}</h3><small>{hit.source}</small>
        <p>{hit.content}</p></article>) : <p>未检索到相关资料，可以按当前 PRD 生成接口文档。</p>}
      <footer><button onClick={() => setReview(null)}>取消</button>
        <button className="primary" onClick={() => generate('api-docs', undefined, review)}>确认并生成接口文档</button></footer>
    </section>}
    {!review && view === 'chatting' && <section className="panel"><MessageList messages={pending ? [...messages, { role: 'user', content: pending }] : messages} streaming={streaming}/>
      {busy && <small className="status" role="status"><LoaderCircle className="animate-spin" size={14}/> 正在回复</small>}
      <ChatInput disabled={busy} onSend={chat}/>
      {!busy && messages.some(m => m.role === 'assistant') && <footer><button className="primary" onClick={() => prepareDocument('prd')}>生成 PRD <ArrowRight size={16}/></button></footer>}
    </section>}
    {!review && kind && <DocumentReview key={kind} title={titles[kind]} content={docs[kind]} streaming={streaming} busy={busy}
      onEdit={content => edit(kind, content)} onOptimize={instruction => generate(kind, instruction)} actions={<>
        {!docs[kind].trim() && <button disabled={busy} onClick={() => prepareDocument(kind)}>重新生成</button>}
        <button className="primary" disabled={busy || !docs[kind].trim()} onClick={() => next ? prepareDocument(next) : patch({ view: 'done' })}>
          {next ? '生成' + titles[next] : '完成并下载'} <ArrowRight size={16}/></button></>}/>}
    {view === 'done' && <section className="panel">{kinds.map(k => <div className="file" key={k}><FileText/>
      <div><h2>{titles[k]}</h2><small>{k}.md</small></div><button onClick={() => downloadFile(k + '.md', docs[k])}><Download size={16}/>下载</button></div>)}
      <footer><button onClick={() => { if (actions) void actions.leave('new'); else { setSession(emptySession()); setError('') } }}>重新开始</button></footer></section>}
    </main></div></div>
}
