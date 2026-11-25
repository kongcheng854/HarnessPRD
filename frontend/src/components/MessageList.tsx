import { useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import type { Message } from '../types'

export default function MessageList({ messages, streaming }: { messages: Message[]; streaming: string }) {
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight }, [messages, streaming])
  const visible = messages.filter(m => m.role !== 'system')
  if (streaming) visible.push({ role: 'assistant', content: streaming })
  return <div className="thread" ref={list}>{visible.map((m,i) => <article key={i} className={'bubble ' + m.role}>
    <strong>{m.role === 'user' ? '你' : 'AI 产品经理'}</strong>
    {m.role === 'assistant' ? <div className="markdown"><Markdown>{m.content}</Markdown></div> : <p>{m.content}</p>}
  </article>)}</div>
}
