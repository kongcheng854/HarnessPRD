import axios from 'axios'
import type { DocKind, Message, QuestionsConfig, RagHit, RequirementsSchema, RequirementsSummary } from '../types'

const base = '/api/conversation'
const http = axios.create({ baseURL: base })
export async function getQuestions(): Promise<QuestionsConfig> {
  return (await http.get<QuestionsConfig>('/questions')).data
}

export async function getRequirementsSchema(): Promise<RequirementsSchema> {
  return (await http.get<RequirementsSchema>('/requirements-schema')).data
}

interface Done { type: 'done'; messages?: Message[]; conversation_id?: string }
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
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { value, done } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        const event = JSON.parse(data)
        if (event.type === 'chunk') onChunk(event.content)
        else if (event.type === 'done') return event
        else if (event.type === 'error') throw new Error(event.message)
      }
      if (done) throw new Error('连接中断，请重试。')
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
export const startConversationStream = (form_data: Record<string, string>, cb: OnChunk) =>
  readStream('/start-stream', { form_data }, cb)
export const startSummaryStream = (requirements_summary: RequirementsSummary, cb: OnChunk, system_prompt_override?: string) =>
  readStream('/start-stream', { requirements_summary, system_prompt_override }, cb)
export const continueConversationStream = (conversation_id: string, messages: Message[], message: string, cb: OnChunk, system_prompt_override?: string) =>
  readStream('/continue-stream', { conversation_id, messages, message, system_prompt_override }, cb)
export const generatePrdStream = (messages: Message[], cb: OnChunk, requirements_summary?: RequirementsSummary) =>
  readStream('/generate-prd-stream', { messages, requirements_summary }, cb)
export const generateApiDocsStream = (prd: string, cb: OnChunk, rag_hits: RagHit[] = []) =>
  readStream('/generate-api-docs-stream', { prd, rag_hits }, cb)
export async function syncSummary(requirements_summary: RequirementsSummary, messages: Message[]) {
  const response = await http.post<{requirements_summary: RequirementsSummary}>('/sync-summary-from-conversation', { requirements_summary, messages })
  return response.data.requirements_summary
}
export async function retrieveApiDocs(prd: string, messages: Message[]) {
  return (await http.post<RagHit[]>('/retrieve-api-docs-rag', { prd, messages })).data
}
export const generatePromptsStream = (prd: string, cb: OnChunk) => readStream('/generate-prompts-stream', { prd }, cb)
export const optimizeDocumentStream = (document_type: DocKind, content: string, instruction: string, cb: OnChunk) =>
  readStream('/optimize-document-stream', { document_type, content, instruction }, cb)
