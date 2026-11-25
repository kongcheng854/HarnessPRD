export interface QuestionConfig {
  name: string
  label: string
  type: 'text' | 'textarea' | 'select' | 'radio'
  required?: boolean
  options?: string[]
}
export interface QuestionsConfig {
  base_questions: QuestionConfig[]
  advanced_questions: QuestionConfig[]
}
export type DocKind = 'prd' | 'api-docs' | 'prompts'
export type ViewState = 'form' | 'chatting' | `generating-${DocKind}` | `review-${DocKind}` | 'done'
export const STEPS = [
  { id: 'form', label: '描述产品' }, { id: 'chatting', label: 'AI 对话' },
  { id: 'review-prd', label: 'PRD' }, { id: 'review-api-docs', label: '接口文档' },
  { id: 'review-prompts', label: '提示词' },
] as const
export interface Message { role: 'assistant' | 'user' | 'system'; content: string }
export interface SessionData {
  view: ViewState
  form: Record<string, string>
  messages: Message[]
  conversationId: string
  docs: Record<DocKind, string>
}
export const titles: Record<DocKind, string> = { prd: '产品需求文档', 'api-docs': '接口文档', prompts: '开发提示词' }
