import type { ModalityKind, TextSubtype } from './types.js'

/**
 * Modelos pré-definidos de emenda ao PLOA, no formato de formulário com quadros
 * (identificação da autoria, acréscimo, cancelamento compensatório, objeto,
 * beneficiário, justificativa e declaração de conformidade).
 * O cabeçalho vem das configurações da instituição ({{cabecalho}}) e os dados do
 * projeto de lei do cadastro do exercício. A instituição pode copiar e ajustar.
 */

const PROJECT_HEADER = `{{cabecalho}}

EMENDA AO PROJETO DE LEI Nº {{projeto_lei}}.

:::recuo
{{ementa_projeto}}
:::

## IDENTIFICAÇÃO DA AUTORIA
{{autoria}}`

const BUDGET_DECLARATION = `:::quadro DECLARAÇÃO DE CONFORMIDADE E ASSINATURA
Declaro, para os devidos fins de direito e sob as penas da lei, que a presente indicação orçamentária: i) respeita as prioridades estabelecidas no Plano Plurianual (PPA) e na Lei de Diretrizes Orçamentárias (LDO); ii) cumpre as diretrizes de transparência e rastreabilidade, não contendo objeto genérico; e iii) em caso de destinação para obras, tenho ciência da prioridade legal para conclusão de obras inacabadas no município.
{{cidade}}, {{data_extenso}}.
{{assinatura_linha}}
:::`

const TEXT_DECLARATION = `:::quadro DECLARAÇÃO DE CONFORMIDADE E ASSINATURA
Declaro, para os devidos fins de direito e sob as penas da lei, que a presente emenda ao texto do PLOA: i) não exclui matéria obrigatória; ii) não inclui matéria vedada; iii) não altera o valor total da despesa fixada; e iv) não altera o valor da previsão da receita.
{{cidade}}, {{data_extenso}}.
{{assinatura_linha}}
:::`

export const BUDGET_FORM_TEMPLATE = `${PROJECT_HEADER}

## ACRÉSCIMO À PROGRAMAÇÃO
{{acrescimo|Valor Destinado (R$)}}

## CANCELAMENTO COMPENSATÓRIO
{{cancelamento}}

## IDENTIFICAÇÃO E QUALIFICAÇÃO DO OBJETO
{{objeto_tabela}}

## IDENTIFICAÇÃO DO BENEFICIÁRIO / EXECUTOR
{{beneficiario_quadro}}

:::quadro JUSTIFICATIVA E INTERESSE PÚBLICO
{{justificativa}}
:::

${BUDGET_DECLARATION}
`

export const TEXT_ADDITIVE_TEMPLATE = `${PROJECT_HEADER}

:::quadro EMENDA ADITIVA
{{comando_texto}}
**Texto a ser acrescido:**
{{texto_novo}}
:::

${TEXT_DECLARATION}
`

export const TEXT_MODIFYING_TEMPLATE = `${PROJECT_HEADER}

:::quadro EMENDA MODIFICATIVA
{{comando_texto}}
**Texto a ser modificado (original):**
{{texto_original}}
**Texto modificado (nova redação):**
{{texto_novo}}
:::

${TEXT_DECLARATION}
`

export const TEXT_SUPPRESSIVE_TEMPLATE = `${PROJECT_HEADER}

:::quadro EMENDA SUPRESSIVA
{{comando_texto}}
**Texto a ser suprimido:**
{{texto_original}}
:::

${TEXT_DECLARATION}
`

/** Modelo simplificado (tabelas horizontais), mantido para instituições que o preferirem. */
export const SIMPLE_TEMPLATE = `# {{instituicao}}
## EMENDA Nº {{numero}} AO PROJETO DE LEI ORÇAMENTÁRIA ANUAL PARA {{exercicio}}

**Modalidade:** {{modalidade}}
**Autoria:** {{parlamentar}} — {{gabinete}}

### Objeto
{{objeto}}

**Valor total:** {{valor_total}}

### Programação de destino (acréscimo)
{{tabela_destinacao}}

### Recursos — anulação compensatória
{{tabela_anulacao}}

### Beneficiário
{{beneficiario}}

### Justificativa
{{justificativa}}

### Fundamentação
{{fundamentacao}}

{{local_data}}

{{assinatura}}
`

export interface TemplatePreset {
  id: string
  name: string
  description: string
  kind: ModalityKind
  textSubtype?: TextSubtype
  body: string
}

export const TEMPLATE_PRESETS: TemplatePreset[] = [
  {
    id: 'formulario-orcamentaria',
    name: 'Formulário — emenda orçamentária (impositiva / remanejamento)',
    description: 'Autoria, acréscimo à programação, cancelamento compensatório, objeto e meta física, beneficiário (A/B), justificativa e declaração de conformidade.',
    kind: 'budget',
    body: BUDGET_FORM_TEMPLATE,
  },
  {
    id: 'formulario-texto-aditiva',
    name: 'Formulário — emenda ao texto aditiva',
    description: 'Comando da emenda e texto a ser acrescido, com declaração de conformidade para emendas ao texto.',
    kind: 'text',
    textSubtype: 'aditiva',
    body: TEXT_ADDITIVE_TEMPLATE,
  },
  {
    id: 'formulario-texto-modificativa',
    name: 'Formulário — emenda ao texto modificativa',
    description: 'Texto original e nova redação do dispositivo.',
    kind: 'text',
    textSubtype: 'modificativa',
    body: TEXT_MODIFYING_TEMPLATE,
  },
  {
    id: 'formulario-texto-supressiva',
    name: 'Formulário — emenda ao texto supressiva',
    description: 'Texto a ser suprimido (mesma estrutura das emendas ao texto).',
    kind: 'text',
    textSubtype: 'supressiva',
    body: TEXT_SUPPRESSIVE_TEMPLATE,
  },
  {
    id: 'simplificado',
    name: 'Modelo simplificado (tabelas)',
    description: 'Layout compacto com tabelas horizontais de destinação e anulação.',
    kind: 'budget',
    body: SIMPLE_TEMPLATE,
  },
]

/** Modelo padrão quando a instituição não configurou um modelo para a modalidade. */
export function defaultTemplateFor(kind: ModalityKind, subtype: TextSubtype | null | undefined): string {
  if (kind === 'text') {
    if (subtype === 'modificativa') return TEXT_MODIFYING_TEMPLATE
    if (subtype === 'supressiva') return TEXT_SUPPRESSIVE_TEMPLATE
    return TEXT_ADDITIVE_TEMPLATE
  }
  return BUDGET_FORM_TEMPLATE
}
