import type {JobFailure, RunSummary} from './job'

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
export interface SchemaProperty {
  title?: string
  properties?: Record<string, SchemaProperty>
  enum?: string[]
  'x-control'?: 'input' | 'select' | 'textarea' | 'list' | 'features' | 'pages'
  'x-placeholder'?: string
  'x-section'?: string
}
export interface RequirementsSchema {
  required: string[]
  properties: Record<string, SchemaProperty>
}
export type RequirementsSummary = Record<string, unknown>
export interface RagHit { source: string; title: string; content: string }
export type PendingReview = { type: 'summary'; candidate: RequirementsSummary } | { type: 'references'; hits: RagHit[] }
export type DocKind = 'prd' | 'api-docs' | 'prompts'
export type ViewState = 'form' | 'chatting' | `generating-${DocKind}` | `review-${DocKind}` | 'done'
export const STEPS = [
  { id: 'form', label: '描述产品' }, { id: 'chatting', label: 'AI 对话' },
  { id: 'review-prd', label: 'PRD' }, { id: 'review-api-docs', label: '接口文档' },
  { id: 'review-prompts', label: '提示词' },
] as const
export interface Message { role: 'assistant' | 'user' | 'system'; content: string }
export interface ContextUsage {
  estimated_input_tokens: number
  budget_tokens: number
  ratio: number
  level: 'ok' | 'warn' | 'exceed'
}
export interface SessionData {
  activeJobId?: string | null
  runSummaries?: Partial<Record<DocKind, RunSummary>>
  optimizationErrors?: Partial<Record<DocKind, JobFailure>>
  prdReviewResult?: Record<string, unknown> | null
  entryMode?: 'form' | 'prd'
  view: ViewState
  form: Record<string, string>
  summary?: RequirementsSummary
  review?: PendingReview
  messages: Message[]
  conversationId: string
  contextUsage?: ContextUsage
  docs: Record<DocKind, string>
}
export const titles: Record<DocKind, string> = { prd: '产品需求文档', 'api-docs': '接口文档', prompts: '开发提示词' }
