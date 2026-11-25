import { useLayoutEffect, useRef, useState } from 'react'
import { Send } from 'lucide-react'

export default function ChatInput({ disabled, onSend }: { disabled: boolean; onSend: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = Math.min(180, ref.current.scrollHeight) + 'px'
    }
  }, [text])
  async function send() {
    if (!disabled && text.trim() && await onSend(text.trim())) setText('')
  }
  return <div className="composer"><textarea rows={1} ref={ref} aria-label="对话回复" placeholder="回复 AI 产品经理…" value={text}
    disabled={disabled} onChange={e => setText(e.target.value)} onKeyDown={e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
    }} /><button className="primary" aria-label="发送回复" onClick={send} disabled={disabled || !text.trim()}><Send size={17}/></button></div>
}
