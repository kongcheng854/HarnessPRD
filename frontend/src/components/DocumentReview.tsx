import { useState, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import { Copy, WandSparkles } from 'lucide-react'

interface Props {
  title: string; content: string; streaming: string; busy: boolean; actions: ReactNode
  onEdit: (text: string) => void; onOptimize: (instruction: string) => Promise<boolean>
}
export default function DocumentReview({ title, content, streaming, busy, actions, onEdit, onOptimize }: Props) {
  const [instruction, setInstruction] = useState('')
  const [notice, setNotice] = useState('')
  async function copy() {
    try { await navigator.clipboard.writeText(content); setNotice('已复制') }
    catch { setNotice('请选中文档内容后手动复制') }
  }
  return <section className="panel"><div className="tools"><h2>{busy ? '正在生成' : '审核与编辑'}</h2>
    <button disabled={busy || !content} onClick={copy}><Copy size={15}/>复制</button></div>
    {notice && <small role="status">{notice}</small>}
    {busy ? <div className="preview markdown"><Markdown>{streaming || '正在等待模型响应…'}</Markdown></div> :
      <textarea className="editor" aria-label={title} value={content} onChange={e => onEdit(e.target.value)}/>}
    <label htmlFor="instruction">修改意见</label><div className="composer"><input id="instruction" placeholder="例如，补充异常流程和验收标准" disabled={busy}
      value={instruction} onChange={e => setInstruction(e.target.value)}/>
      <button disabled={busy || !instruction.trim() || !content.trim()} onClick={async () => {
        if (await onOptimize(instruction.trim())) setInstruction('')
      }}><WandSparkles size={16}/>AI 优化</button></div>
    <footer>{actions}</footer></section>
}
