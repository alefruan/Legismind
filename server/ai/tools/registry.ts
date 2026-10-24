import { z } from 'zod'
import type { ToolCard } from '../../../shared/types/assistant.js'
import type { RequestContext } from '../../http/auth.js'
import type { EmbeddingProvider } from '../embeddings.js'
import type { ToolSpec } from '../types.js'

export interface ToolContext {
  req: RequestContext
  organizationId: string
  officeId: string | null
  fiscalYearId: string | null
  fiscalYear: number | null
  isDemo: boolean
  conversationId: string
  embeddings: EmbeddingProvider | null
  /** Emendas criadas nesta conversa (vinculadas à conversa ao final). */
  createdAmendments: string[]
}

export interface ToolOutput {
  /** Conteúdo enviado ao modelo (serializado como JSON quando não for string). */
  content: unknown
  /** Resumo curto para a interface. */
  summary: string
  card?: ToolCard
}

export interface AssistantTool<S extends z.ZodType = z.ZodType> {
  name: string
  /** Rótulo exibido enquanto a ferramenta executa. */
  label: string
  description: string
  schema: S
  execute(ctx: ToolContext, input: z.infer<S>): Promise<ToolOutput>
}

export function defineTool<S extends z.ZodType>(tool: AssistantTool<S>): AssistantTool<S> {
  return tool
}

export class ToolUserError extends Error {}

export function toToolSpec(tool: AssistantTool): ToolSpec {
  const schema = z.toJSONSchema(tool.schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>
  delete schema.$schema
  return { name: tool.name, description: tool.description, inputSchema: { ...schema, type: 'object' } }
}

export function requireFiscalYear(ctx: ToolContext): string {
  if (!ctx.fiscalYearId) throw new ToolUserError('Nenhum exercício orçamentário ativo. Peça à administração para ativar um exercício.')
  return ctx.fiscalYearId
}

export function requireOffice(ctx: ToolContext): string {
  if (!ctx.officeId) throw new ToolUserError('Nenhum gabinete selecionado. O usuário precisa selecionar um gabinete para criar ou editar emendas.')
  return ctx.officeId
}

/** Valores informados pelo modelo em reais → string decimal com 2 casas. */
export const reais = z.number().positive().max(1e13).describe('Valor em reais (ex.: 150000 para R$ 150.000,00)')
