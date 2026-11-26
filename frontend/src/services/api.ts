import axios from 'axios'
import { sseData } from '../utils/sse'
import type { ContextUsage, DocKind, Message, QuestionsConfig, RequirementsSchema, RequirementsSummary } from '../types'

const base = '/api/conversation'
const http = axios.create({ baseURL: base })
export async function getQuestions(): Promise<QuestionsConfig> {
  return (await http.get<QuestionsConfig>('/questions')).data
}

export async function getRequirementsSchema(): Promise<RequirementsSchema> {
  return (await http.get<RequirementsSchema>('/requirements-schema')).data
}

interface Done { type: 'done'; messages?: Message[]; conversation_id?: string; context_usage?: ContextUsage }
type OnChunk = (text: string) => void

export async function readStream(path: string, body: unknown, onChunk: OnChunk): Promise<Done> {
  const response = await fetch(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  })
  if (response.status === 422) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : '请检查表单字段后重试。')
  }
  if (!response.ok || !response.body) throw new Error('请求失败（HTTP ' + response.status + '），请检查后端后重试。')
  for await (const data of sseData(response)) {
    const event = JSON.parse(data)
    if (event.type === 'chunk') onChunk(event.content)
    else if (event.type === 'done') return event
    else if (event.type === 'error') throw new Error(event.message)
  }
  throw new Error('连接中断，请重试。')
}
export const startConversationStream = (form_data: Record<string, string>, cb: OnChunk) =>
  readStream('/start-stream', { form_data }, cb)
export const startSummaryStream = (requirements_summary: RequirementsSummary, cb: OnChunk, system_prompt_override?: string) =>
  readStream('/start-stream', { requirements_summary, system_prompt_override }, cb)
export const continueConversationStream = (conversation_id: string, messages: Message[], message: string, cb: OnChunk, system_prompt_override?: string) =>
  readStream('/continue-stream', { conversation_id, messages, message, system_prompt_override }, cb)
export const generatePrdStream = (messages: Message[], cb: OnChunk, requirements_summary?: RequirementsSummary) =>
  readStream('/generate-prd-stream', { messages, requirements_summary }, cb)
export const generateApiDocsStream = (prd: string, cb: OnChunk) =>
  readStream('/generate-api-docs-stream', { prd }, cb)
export async function syncSummary(requirements_summary: RequirementsSummary, messages: Message[]) {
  const response = await http.post<{requirements_summary: RequirementsSummary}>('/sync-summary-from-conversation', { requirements_summary, messages })
  return response.data.requirements_summary
}
export const generatePromptsStream = (prd: string, cb: OnChunk) => readStream('/generate-prompts-stream', { prd }, cb)
export const optimizeDocumentStream = (document_type: DocKind, content: string, instruction: string, cb: OnChunk) =>
  readStream('/optimize-document-stream', { document_type, content, instruction }, cb)
