import type { ValidationOutcome } from '../domain/amendments/types.js'

/** Cartões estruturados exibidos na conversa a partir dos resultados das ferramentas. */
export interface AllocationCardItem {
  id: string
  code: string
  action: string
  nature: string
  source: string
  amount: string
  verification: 'confirmed' | 'pending_review' | 'rejected'
  isDemo: boolean
  document?: string | null
  page?: number | null
}

export type ToolCard =
  | { kind: 'context'; organization: string; fiscalYear: number | null; office: string | null; rules: number; isDemo: boolean }
  | { kind: 'allocations'; items: AllocationCardItem[]; total: number }
  | { kind: 'citations'; items: Array<{ title: string; reference: string; section: string | null; excerpt: string; suspicious: boolean }> }
  | {
      kind: 'candidates'
      requested: number
      covered: number
      suggestion: Array<{ allocationId: string; code: string; nature: string; source: string; amountCents: number; basis: string }>
      eligible: number
      exclusions: Array<{ reason: string; count: number }>
    }
  | { kind: 'checks'; checks: Array<{ code: string; title: string; outcome: ValidationOutcome; message: string }> }
  | { kind: 'amendment'; amendmentId: string; title: string; status: string; totalCents: number; created: boolean }
  | {
      kind: 'validation'
      amendmentId: string
      outcome: ValidationOutcome
      counts: { validated: number; pending: number; inconsistent: number; notVerifiable: number }
      checks: Array<{ code: string; title: string; outcome: ValidationOutcome; severity: string; message: string; human: boolean }>
    }
  | { kind: 'document'; amendmentId: string; pending: string[]; watermark: string | null }
  | { kind: 'interpretation'; amountCents: number | null; area: string | null; beneficiary: string | null; functions: string[]; missing: string[] }

export interface ToolEventRecord {
  id: string
  name: string
  label: string
  ok: boolean
  summary: string
  card?: ToolCard
}

export type AssistantStreamEvent =
  | { type: 'conversation'; conversationId: string; title: string }
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; name: string; label: string; ok: boolean; summary: string; card?: ToolCard }
  | { type: 'notice'; level: 'info' | 'warning'; message: string }
  | { type: 'done'; conversationId: string; messageId: string | null; usage: { inputTokens: number; outputTokens: number } }
  | { type: 'error'; code?: string; message: string }

export interface AssistantChatRequest {
  organizationId: string
  officeId?: string | null
  fiscalYearId?: string | null
  conversationId?: string | null
  message: string
}
