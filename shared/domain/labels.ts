/** Rótulos em português para os enumerados do banco. */

export const memberRoleLabels = {
  org_admin: 'Administrador da instituição',
  parliamentarian: 'Parlamentar',
  advisor: 'Assessor parlamentar',
  reviewer: 'Revisor jurídico/orçamentário',
} as const

export const officeRoleLabels = {
  titular: 'Titular',
  chief_of_staff: 'Chefe de gabinete',
  advisor: 'Assessor',
} as const

export const orgKindLabels = {
  camara_municipal: 'Câmara Municipal',
  assembleia_legislativa: 'Assembleia Legislativa',
  camara_legislativa_df: 'Câmara Legislativa do DF',
} as const

export const orgStatusLabels = {
  trial: 'Avaliação',
  active: 'Ativa',
  suspended: 'Suspensa',
  archived: 'Arquivada',
} as const

export const fiscalPhaseLabels = {
  ploa: 'Projeto de LOA',
  loa: 'LOA aprovada',
  execution: 'Em execução',
  closed: 'Encerrado',
} as const

export const documentTypeLabels = {
  loa: 'LOA',
  ploa: 'Projeto de LOA',
  ldo: 'LDO',
  ppa: 'PPA',
  constituicao_federal: 'Constituição Federal',
  constituicao_estadual: 'Constituição Estadual',
  lei_organica: 'Lei Orgânica',
  regimento_interno: 'Regimento Interno',
  lei_complementar: 'Lei Complementar',
  lei_ordinaria: 'Lei Ordinária',
  resolucao: 'Resolução',
  decreto: 'Decreto',
  manual_tecnico: 'Manual Técnico',
  modelo_emenda: 'Modelo de Emenda',
  anexo_orcamentario: 'Anexo Orçamentário',
  outro: 'Outro',
} as const

export type DocumentType = keyof typeof documentTypeLabels

export const budgetDocumentTypes: DocumentType[] = ['loa', 'ploa', 'anexo_orcamentario']

export const documentStatusLabels = {
  active: 'Vigente',
  obsolete: 'Obsoleto',
  draft: 'Rascunho',
} as const

export const processingStatusLabels = {
  pending_upload: 'Aguardando envio',
  queued: 'Na fila',
  processing: 'Processando',
  needs_review: 'Requer conferência',
  completed: 'Concluído',
  failed: 'Falhou',
} as const

export const jobStageLabels: Record<string, string> = {
  queued: 'Na fila',
  download: 'Baixando arquivo',
  verify: 'Verificando integridade',
  extract: 'Extraindo texto',
  ocr: 'Reconhecimento óptico (OCR)',
  chunk: 'Segmentando trechos',
  budget_parse: 'Identificando dotações',
  budget_import: 'Gravando estrutura orçamentária',
  embed: 'Gerando embeddings',
  finalize: 'Finalizando',
  done: 'Concluído',
  failed: 'Falhou',
}

export const verificationStatusLabels = {
  confirmed: 'Conferida',
  pending_review: 'Pendente de conferência',
  rejected: 'Rejeitada',
} as const

export const ruleStatusLabels = {
  draft: 'Rascunho',
  active: 'Ativa',
  archived: 'Arquivada',
} as const

export const sphereLabels = {
  federal: 'Federal',
  estadual: 'Estadual',
  municipal: 'Municipal',
  interna: 'Norma interna',
} as const

export const beneficiaryTypeLabels = {
  none: 'Não se aplica',
  osc: 'Organização da sociedade civil (OSC)',
  public_entity: 'Entidade pública',
  own_administration: 'Execução direta pela Administração',
  other: 'Outro',
} as const

export const transferInstrumentLabels = {
  termo_fomento: 'Termo de fomento',
  termo_colaboracao: 'Termo de colaboração',
  acordo_cooperacao: 'Acordo de cooperação',
  convenio: 'Convênio',
  transferencia_fundo_a_fundo: 'Transferência fundo a fundo',
  aplicacao_direta: 'Aplicação direta',
  outro: 'Outro',
} as const

export const actionKindLabels = {
  projeto: 'Projeto',
  atividade: 'Atividade',
  operacao_especial: 'Operação especial',
  nao_informado: 'Não informado',
} as const
