import type { AssistantTool } from './registry.js'
import { getWorkspaceContext } from './context.js'
import { checkAllocationForDestination, findCancellationCandidatesTool, getBudgetAllocation, searchBudgetAllocations } from './budget.js'
import { searchLegalDocuments } from './legal.js'
import { createAmendmentDraft, generateAmendmentDocument, getAmendment, updateAmendmentDraft, validateAmendmentTool } from './amendments.js'

/** Ordem estável: o conjunto de ferramentas faz parte do prefixo em cache. */
export const assistantTools: AssistantTool[] = [
  getWorkspaceContext,
  searchBudgetAllocations,
  getBudgetAllocation,
  searchLegalDocuments,
  findCancellationCandidatesTool,
  checkAllocationForDestination,
  createAmendmentDraft,
  updateAmendmentDraft,
  getAmendment,
  validateAmendmentTool,
  generateAmendmentDocument,
] as AssistantTool[]

export const toolsByName = new Map(assistantTools.map((t) => [t.name, t]))
