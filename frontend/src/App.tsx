import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import axios from 'axios'
import { AlertTriangle, ArrowRight, Check, Download, FileText, Layers3, LoaderCircle } from 'lucide-react'
import { STEPS, titles, entryViews, type EntryMode, type DocKind, type PendingReview, type RequirementsSchema, type RequirementsSummary, type SessionData, type ViewState } from './types'
import * as api from './services/api'
import { downloadFile, emptySession, loadSession, saveSession } from './session'
import AppV2, { CLARIFICATION_SYSTEM_PROMPT } from './AppV2'
import SummaryDiffPanel from './components/SummaryDiffPanel'
import ChatInput from './components/ChatInput'
import ClarificationWarnBanner from './components/ClarificationWarnBanner'
import ClarificationStage from './components/ClarificationStage'
import MessageList from './components/MessageList'
import DocumentReview, { type DocumentReviewProps } from './components/DocumentReview'
import ProjectEntryChooser from './components/project-entry/ProjectEntryChooser'
import ImportPrdPanel from './components/project-entry/ImportPrdPanel'
import ImportPromptsPanel from './components/project-entry/ImportPromptsPanel'
import type { useGenerationJob } from './hooks/useGenerationJob'
import { summaryToFormData } from './utils/structuredFormTransform'
import { buildArtifactNodes } from './utils/artifactProgress'
import { assessClarificationState } from './utils/clarificationState'
import { confirmGenerateDespiteClarificationWarnings } from './utils/clarificationConfirm'
import { canPerformAction, unconfirmedBaseline } from './utils/deliveryStage'
import ArtifactProgressBar from './components/ArtifactProgressBar'

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
  versionBusy: boolean
  renderReview: (kind: DocKind, props: DocumentReviewProps) => React.ReactNode
  jobs: ReturnType<typeof useGenerationJob>
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
  const clarificationState = useMemo(() => assessClarificationState(messages), [messages])
  const structuredClarification = session.entryMode === 'structured' || session.entryMode === 'form'
  const subView = actions ? session.formSubView ?? (session.entryMode ? entryViews[session.entryMode] : 'chooser') : 'structured'
  const kind = kinds.find(k => view === 'review-' + k || view === 'generating-' + k)
  const step = view === 'done' ? 5 : kind ? kinds.indexOf(kind) + 2 : view === 'chatting' ? 1 : 0
  useEffect(() => {
    let active = true
    setConfigError(false)
    api.getRequirementsSchema().then(data => { if (active) setSchema(data) }).catch(() => { if (active) setConfigError(true) })
    return () => { active = false }
  }, [attempt])
  function patch(data: Partial<SessionData>) { setSession(s => ({ ...s, ...data })) }
  function selectEntry(entryMode: EntryMode) {
    setError('')
    patch({entryMode, formSubView: entryViews[entryMode]})
  }
  function enterImportedDocument(kind: 'prd' | 'api-docs') {
    return run(async () => patch({view: `review-${kind}`}), () => {})
  }
  function setReview(value: Review | null) {
    setLoadingReview(value?.type === 'loading' ? value : null)
    patch({review: value && value.type !== 'loading' ? value : undefined})
  }
  function edit(key: DocKind, content: string) {
    setSession(s => ({
      ...s, ...(actions && key === 'prd' && content !== s.docs.prd ? unconfirmedBaseline : {}),
      docs: { ...s.docs, [key]: content },
    }))
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
      patch({ conversationId: result.conversation_id, messages: result.messages, contextUsage: result.context_usage,
        summary: typeof input === 'string' ? session.summary : input })
    }, () => patch({ view: typeof input === 'string' ? 'chatting' : 'form' }))
  }
  function prepareDocument(key: DocKind) {
    if (key !== 'prd') return generate(key)
    if (actions && structuredClarification) {
      const delivery = canPerformAction('generate_prd', {requirementsSummary: session.summary})
      if (!delivery.allowed) {
        setError(delivery.reason)
        return Promise.resolve(false)
      }
      if (!confirmGenerateDespiteClarificationWarnings(clarificationState)) return Promise.resolve(false)
    }
    return run(async () => {
      if (key === 'prd') {
        setReview({type: 'loading', label: '正在核对访谈与需求摘要…'})
        const candidate = messages.length
          ? await api.syncSummary(session.summary ?? {}, messages)
          : session.summary ?? {}
        setReview({type: 'summary', candidate})
      } else {
        generate(key)
      }
    }, () => setReview(null))
  }
  function generate(key: DocKind, instruction?: string, approved?: Extract<Review, {type: 'summary'}>) {
    if (actions && !instruction) {
      const delivery = key === 'prd' ? canPerformAction('generate_prd', {requirementsSummary: approved?.candidate})
        : downstreamDelivery(key)
      if (!delivery.allowed) {
        setError(delivery.reason)
        return Promise.resolve(false)
      }
    }
    if (actions) return run(async () => {
      if (instruction) {
        if (!docs[key].trim()) throw new Error('请先填写需要优化的正文。')
        const context = key === 'prompts' ? [docs.prd, docs['api-docs']].filter(Boolean).join('\n\n')
          : key === 'api-docs' ? docs.prd : ''
        await actions.jobs.startOptimize(key, docs[key], instruction, context)
      } else if (key === 'prd' && approved?.type === 'summary') await actions.jobs.startPrd(approved.candidate)
      else if (key === 'api-docs') await actions.jobs.startApiDocs(docs.prd)
      else if (key === 'prompts') await actions.jobs.startPrompts(docs.prd, docs['api-docs'])
      else throw new Error('请先确认生成资料。')
    }, () => {})
    return run(async () => {
      setReview(null)
      patch({ view: `generating-${key}`, ...(approved?.type === 'summary' &&
        {summary: approved.candidate, form: summaryToFormData(approved.candidate)}) })
      let content = ''
      const chunk = (part: string) => { content += part; setStreaming(content) }
      if (instruction) await api.optimizeDocumentStream(key, docs[key], instruction, chunk)
      else if (key === 'prd' && approved?.type === 'summary') await api.generatePrdStream(messages, chunk, approved.candidate)
      else if (key === 'api-docs') await api.generateApiDocsStream(docs.prd, chunk)
      else if (key === 'prompts') await api.generatePromptsStream(docs.prd, chunk)
      else throw new Error('请先确认生成资料。')
      if (!content.trim()) throw new Error('文档为空，请重试。')
      setSession(s => ({ ...s, docs: { ...s.docs, [key]: content }, view: `review-${key}` }))
    }, () => patch({ view: `review-${key}` }))
  }
  const next = kind && kinds[kinds.indexOf(kind) + 1]
  const jobs = actions?.jobs
  const documentBusy = busy || Boolean(jobs?.isJobRunning)
  const clarificationActionLocked = documentBusy || Boolean(actions?.versionBusy)
  const optimizationError = kind && !documentBusy ? session.optimizationErrors?.[kind] : undefined
  function documentEditor(kind: DocKind, props: DocumentReviewProps) {
    return actions && view.startsWith('review-') ? actions.renderReview(kind, props) : <DocumentReview key={kind} {...props}/>
  }
  const formHeadings = {chooser: '新建 PRD 方案', structured: '描述你的产品', 'import-prd': '导入 PRD', 'import-prompts': '导入 PRD 与接口文档'}
  const heading = kind ? titles[kind] : view === 'done' ? '文档已就绪' : view === 'chatting' ? '需求访谈' : formHeadings[subView]
  const showForm = view === 'form' && !review
  const imported = session.entryMode === 'prd' || session.entryMode === 'prompts'
  function navigateTo(view: ViewState) {
    return run(async () => patch(view === 'form' ? {view, formSubView: session.entryMode ? entryViews[session.entryMode] : 'structured'} : {view}), () => {})
  }
  function downstreamDelivery(doc: 'api-docs' | 'prompts') {
    return canPerformAction(doc === 'api-docs' ? 'generate_api_docs' : 'generate_prompts', {
      prdBaselineConfirmed: session.prdBaselineConfirmed, prdContent: docs.prd,
    })
  }
  function reviewActions(doc: DocKind) {
    if (!actions) return null
    const {startPrompts} = actions.jobs
    const hasPrd = !!docs.prd.trim()
    const hasApi = !!docs['api-docs'].trim()
    const canGenerateDownstream = downstreamDelivery('api-docs').allowed
    const backTo: ViewState = doc === 'prompts' && hasApi ? 'review-api-docs' :
      doc !== 'prd' && hasPrd ? 'review-prd' : !imported && conversationId ? 'chatting' : 'form'
    const backLabel = { 'review-api-docs':'返回接口文档', 'review-prd':'返回 PRD', chatting:'返回对话', form:'返回入口' }[backTo]
    function skipApiDocs() {
      if (!window.confirm('跳过接口文档时，提示词可能缺少 API 细节。是否继续？')) return
      return run(() => startPrompts(docs.prd, ''), () => {})
    }
    function directPrompts() {
      return run(() => startPrompts(docs.prd, docs['api-docs']), () => {})
    }
    return <div className="review-actions">
      <button disabled={documentBusy} onClick={() => navigateTo(backTo)}>{backLabel}</button>
      <button disabled={documentBusy || (doc !== 'prd' && !canGenerateDownstream)} onClick={() => prepareDocument(doc)}>重新生成</button>
      <button className="quiet-action" disabled={documentBusy} onClick={() => patch({view:'done'})}>结束任务</button>
      {doc === 'prd' && (session.entryMode === 'structured' ? (
        <>
          <button className="primary" disabled={documentBusy || !canGenerateDownstream} onClick={() => prepareDocument('api-docs')}>
            生成接口文档 <ArrowRight size={16}/></button>
          <button className="skip-api" disabled={documentBusy || !canGenerateDownstream} onClick={skipApiDocs}>
            跳过接口文档，直接生成提示词</button>
        </>
      ) : (
        <>
          <button className="skip-api" disabled={documentBusy || !canGenerateDownstream} onClick={directPrompts}>
            直接生成提示词</button>
          <button className="primary" disabled={documentBusy || !canGenerateDownstream} onClick={() => prepareDocument('api-docs')}>
            生成接口文档 <ArrowRight size={16}/></button>
        </>
      ))}
      {doc === 'api-docs' && <button className="primary" disabled={documentBusy || !canGenerateDownstream || !hasApi}
        onClick={() => prepareDocument('prompts')}>生成提示词 <ArrowRight size={16}/></button>}
      {doc !== 'prd' && hasPrd && !canGenerateDownstream && <small>请返回 PRD 确认需求基线后生成。</small>}
    </div>
  }
  return <div className="app">
    <header><div className="brand"><span className="logo"><Layers3 size={21}/></span>Harness<span>PRD</span></div>
      <span className="workspace">产品工作台</span>
      {actions && <nav className="workspace-nav">
        <button disabled={busy} onClick={() => actions.leave('list')}>我的方案</button>
        <button disabled={busy} onClick={() => actions.leave('new')}>结束当前任务</button>
        <button disabled={busy} onClick={() => actions.leave('new')}>新建</button>
      </nav>}</header>
    <div className="layout">{actions ? !(view === 'form' && subView === 'chooser') &&
      <ArtifactProgressBar nodes={buildArtifactNodes(session)} locked={documentBusy || !!review || actions.versionBusy} onNavigate={navigateTo}/> :
      <aside><h2>项目流程</h2><ol>{STEPS.map((s,i) =>
      <li key={s.id} className={i === step ? 'active' : i < step ? 'complete' : ''} aria-current={i === step ? 'step' : undefined}>
        <span>{i < step ? <Check size={14}/> : i + 1}</span>{s.label}</li>)}</ol></aside>}
    <main>
    {showForm && actions && subView !== 'chooser' && <button className="disclosure" disabled={busy}
      onClick={() => { setError(''); patch({formSubView:'chooser'}) }}>← 返回路径选择</button>}
    {actions && imported && !review && view.startsWith('review-') && kind !== 'prd' && <button className="disclosure" disabled={documentBusy || actions.versionBusy}
      onClick={() => patch({view:'form', formSubView:entryViews[session.entryMode!]})}>← 返回入口</button>}
    {(!actions || !showForm || subView !== 'chooser') && <div className="eyebrow">{String(session.summary?.product_name || form.product_name || '新建项目')}</div>}
    <h1>{heading}</h1>
    {showForm && (subView === 'chooser' || subView === 'structured') && <p className="lead">{subView === 'chooser'
      ? '选择本次工作的起点' : '填写产品构想，AI 产品经理将据此与你梳理需求。'}</p>}
    {error && <div className="alert" role="alert">{error}</div>}
    {jobs?.error && <div className="alert" role="alert">{jobs.error}</div>}
    {optimizationError && <div className="alert" role="alert">{optimizationError.message}（请求 ID {optimizationError.request_id}）</div>}
    {saveError && <div className="alert" role="status">浏览器无法保存本次进度，请在关闭前下载文档。</div>}
    {showForm && subView === 'chooser' && <ProjectEntryChooser onSelect={selectEntry}/>}
    {showForm && subView === 'import-prd' && <fieldset disabled={busy}><ImportPrdPanel prd={docs.prd}
      onEdit={value => edit('prd', value)} onEnterPrdReview={() => enterImportedDocument('prd')}
      onStartApiDocs={() => prepareDocument('api-docs')}/></fieldset>}
    {showForm && subView === 'import-prompts' && <fieldset disabled={busy}><ImportPromptsPanel docs={docs} onEdit={edit}
      onEnterStage={() => enterImportedDocument(docs['api-docs'].trim() ? 'api-docs' : 'prd')}
      onStartPrompts={() => generate('prompts')}/></fieldset>}
    {showForm && subView === 'structured' && actions && conversationId && messages.length > 0 &&
      <button className="disclosure" disabled={busy} onClick={() => patch({view:'chatting'})}>继续已有澄清对话 →</button>}
    {showForm && subView === 'structured' && (schema ? <fieldset disabled={busy}><AppV2 schema={schema} values={form}
      onChange={values => patch({form:values})} onSubmit={chat}
      onGenerateFrozen={actions ? (summary, caseId, button) => run(() => actions.jobs.startFrozenPrd(summary, caseId, button), () => {}) : undefined}/></fieldset> :
      <div className="panel">{configError ? <>表单加载失败，请检查后端连接。 <button onClick={() => setAttempt(n => n+1)}>重试</button></> : '正在加载表单…'}</div>)}
    {review?.type === 'loading' && <div className="panel" role="status">{review.label}</div>}
    {review?.type === 'summary' && <SummaryDiffPanel before={session.summary ?? {}} after={review.candidate}
      onReject={() => setReview(null)} onConfirm={() => generate('prd', undefined, review)}/>}
    {!review && view === 'chatting' && <section className="panel">
      {actions && structuredClarification && <ClarificationStage state={clarificationState}/>}
      <MessageList messages={pending ? [...messages, { role: 'user', content: pending }] : messages} streaming={streaming}/>
      {busy && <small className="status" role="status"><LoaderCircle className="animate-spin" size={14}/> 正在回复</small>}
      <ClarificationWarnBanner usage={session.contextUsage}/>
      <ChatInput disabled={busy} onSend={chat}/>
      {(actions ? structuredClarification && !!session.summary : messages.some(m => m.role === 'assistant')) && <footer>
        <button className={actions && clarificationState.needsConfirmBeforeGenerate ? 'clarification-warning' : 'primary'}
          disabled={clarificationActionLocked} onClick={() => prepareDocument('prd')}>
          {actions && clarificationState.needsConfirmBeforeGenerate && <AlertTriangle size={16} aria-hidden="true"/>}
          生成 PRD <ArrowRight size={16}/></button></footer>}
    </section>}
    {!review && kind && documentEditor(kind, {title: titles[kind], content: docs[kind],
      streaming: jobs?.isJobRunning ? jobs.streamingContent : streaming, busy: documentBusy,
      optimizing: jobs?.isOptimizingJob, reconnecting: jobs?.reconnecting,
      progress: jobs?.isJobRunning && !jobs.isOptimizingJob ? {phase:jobs.phase, seconds:jobs.seconds, reconnecting:jobs.reconnecting, artifact:kind} : undefined,
      metrics: !documentBusy ? session.runSummaries?.[kind] : null,
      onRegenerate: actions && kind !== 'prd' ? () => { void prepareDocument(kind) } : undefined,
      canRegenerate: kind !== 'prd' && downstreamDelivery(kind).allowed,
      onEdit: content => edit(kind, content), onOptimize: instruction => generate(kind, instruction),
      actions: actions && view.startsWith('review-') ? reviewActions(kind) : <>
        {(!docs[kind].trim() || (actions && view.startsWith('review-'))) && <button disabled={documentBusy} onClick={() => prepareDocument(kind)}>重新生成</button>}
        <button className="primary" disabled={documentBusy || !docs[kind].trim()} onClick={() => next ? prepareDocument(next) : patch({ view: 'done' })}>
          {next ? '生成' + titles[next] : '完成并下载'} <ArrowRight size={16}/></button></>})}
    {view === 'done' && <section className="panel">{kinds.filter(k => !actions || docs[k].trim()).map(k => <div className="file" key={k}><FileText/>
      <div><h2>{titles[k]}</h2><small>{k}.md</small></div><button onClick={() => downloadFile(k + '.md', docs[k])}><Download size={16}/>下载</button></div>)}
      <footer><button onClick={() => { if (actions) void actions.leave('new'); else { setSession(emptySession()); setError('') } }}>重新开始</button></footer></section>}
    </main></div></div>
}
