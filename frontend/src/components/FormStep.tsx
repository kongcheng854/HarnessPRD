import { useState, type FormEvent } from 'react'
import { ArrowRight, ChevronDown } from 'lucide-react'
import type { QuestionConfig, QuestionsConfig } from '../types'

interface Props {
  questions: QuestionsConfig
  values: Record<string, string>
  onChange: (name: string, value: string) => void
  onSubmit: () => void
}
export default function FormStep({ questions, values, onChange, onSubmit }: Props) {
  const [advanced, setAdvanced] = useState(false)
  const [missing, setMissing] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    const empty = [...questions.base_questions, ...questions.advanced_questions].find(q => q.required && !values[q.name]?.trim())
    if (empty) {
      setMissing(empty.name)
      if (questions.advanced_questions.includes(empty)) setAdvanced(true)
      requestAnimationFrame(() => document.getElementById(empty.name)?.focus())
    } else onSubmit()
  }
  function field(q: QuestionConfig) {
    const value = values[q.name] || ''
    const attrs = { id: q.name, name: q.name, required: q.required, value,
      'aria-invalid': missing === q.name && !value.trim(),
      onChange: (e: { target: { value: string } }) => onChange(q.name, e.target.value) }
    const label = <>{q.label}{q.required && <span className="required"> *</span>}</>
    return <div key={q.name} className="field">
      {q.type === 'radio' ? <fieldset><legend>{label}</legend><div className="options">{q.options?.map((o,i) =>
        <label key={o}><input {...attrs} id={i === 0 ? q.name : undefined} type="radio" value={o} checked={value === o} /> {o}</label>)}</div></fieldset> :
        <><label htmlFor={q.name}>{label}</label>
        {q.type === 'textarea' ? <textarea {...attrs} rows={3} /> : q.type === 'select' ?
          <select {...attrs}><option value="">请选择</option>{q.options?.map(o => <option key={o}>{o}</option>)}</select> :
          <input type="text" {...attrs} />}</>}
      {attrs['aria-invalid'] && <small role="alert">请填写此项</small>}
    </div>
  }
  return <form noValidate onSubmit={submit} className="panel">
    {questions.base_questions.map(field)}
    <button type="button" className="disclosure" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>
      高级问题 <ChevronDown size={16} style={{ transform: advanced ? 'rotate(180deg)' : undefined }} /></button>
    {advanced && questions.advanced_questions.map(field)}
    <footer><button className="primary">开始 AI 对话 <ArrowRight size={16}/></button></footer>
  </form>
}
