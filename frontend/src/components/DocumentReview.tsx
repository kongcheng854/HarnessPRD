import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import { Copy, WandSparkles } from 'lucide-react'
import type { JobPhase, RunSummary } from '../types/job'
import type { DocKind } from '../types'

interface Props {
  progress?: {phase:JobPhase; seconds:number; reconnecting:boolean; artifact:DocKind}
  metrics?: RunSummary | null
  optimizing?: boolean
  reconnecting?: boolean
  title: string; content: string; streaming: string; busy: boolean; actions: ReactNode
  onEdit: (text: string) => void; onOptimize: (instruction: string) => Promise<boolean>
}
const phaseNames = {writing:'起草',reviewing:'审查',rewriting:'改写',generating:'生成',done:'完成'}
export default function DocumentReview({ title, content, streaming, busy, actions, onEdit, onOptimize, progress, metrics, optimizing, reconnecting }: Props) {
  const [instruction, setInstruction] = useState('')
  const [notice, setNotice] = useState('')
  async function copy() {
    try { await navigator.clipboard.writeText(content); setNotice('已复制') }
    catch { setNotice('请选中文档内容后手动复制') }
  }
  return <section className="panel"><div className="tools"><h2>{optimizing ? '正在优化' : busy ? '正在生成' : '审核与编辑'}</h2>
    <button disabled={busy || !content} onClick={copy}><Copy size={15}/>复制</button></div>
    {notice && <small role="status">{notice}</small>}
    {optimizing && reconnecting && <small role="status">正在重新连接优化任务…</small>}
    {progress && <div className="flex flex-wrap items-center gap-3 pb-4">
      <ol className="flex gap-3" aria-label="文档生成阶段">
        {(progress.artifact === 'prd' ? ['writing','reviewing','rewriting'] as const : ['generating'] as const).map(p =>
          <li key={p} aria-current={p === progress.phase ? 'step' : undefined}
            className={p === progress.phase ? 'font-semibold text-primary-700' : 'text-slate-500'}>{phaseNames[p]}</li>)}
      </ol><small>{progress.seconds} 秒</small>
      {progress.reconnecting && <small role="status">正在重新连接生成任务…</small>}
      {progress.phase === 'reviewing' && <small>正在核对初稿与已确认的需求。</small>}
    </div>}
    {metrics && metrics.total_duration_ms !== null && <small className="block mb-3">
      {metrics.run_type === 'optimize_document' ? '优化' : '生成'}耗时 {(metrics.total_duration_ms / 1000).toFixed(1)} 秒
      {metrics.total_input_tokens != null && metrics.total_output_tokens != null && ` · 输入 ${metrics.total_input_tokens} / 输出 ${metrics.total_output_tokens} Token`}
    </small>}
    {busy ? <div className="preview markdown"><Markdown>{streaming || '正在等待模型响应…'}</Markdown></div> :
      <textarea className="editor" aria-label={title} value={content} onChange={e => onEdit(e.target.value)}/>}
    <label htmlFor="instruction">修改意见</label><div className="composer"><input id="instruction" placeholder="例如，补充异常流程和验收标准" disabled={busy}
      value={instruction} onChange={e => setInstruction(e.target.value)}/>
      <button disabled={busy || !instruction.trim() || !content.trim()} onClick={async () => {
        if (await onOptimize(instruction.trim())) setInstruction('')
      }}><WandSparkles size={16}/>AI 优化</button></div>
    <footer>{actions}</footer></section>
}
