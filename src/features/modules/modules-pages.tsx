import { Link, useNavigate } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Briefcase, FileText, MessagesSquare, PenLine, Scale } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AmendmentStatusBadge, Pill } from '@/components/common/badges'
import { PageHeader } from '@/components/common/page-header'
import { PageContainer } from '@/components/layout/app-shell'
import type { AmendmentStatus } from '@shared/domain/amendments/status'
import { supabase, unwrap } from '@/lib/supabase'
import { money, timeAgo } from '@/lib/format'
import { useAuth } from '@/providers/auth'
import { useRequiredWorkspace } from '@/providers/workspace'

/**
 * Módulos em implantação progressiva. Cada página informa com clareza o que já
 * funciona hoje (via Assistente e Base Legislativa) e o que está planejado —
 * sem botões que simulem funcionalidades inexistentes.
 */
function ModulePage({
  icon: Icon,
  title,
  description,
  available,
  planned,
  prompts,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  available: string[]
  planned: string[]
  prompts: string[]
}) {
  const navigate = useNavigate()
  return (
    <PageContainer>
      <PageHeader eyebrow="Módulo" title={title} description={description} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Icon className="size-4 text-brand" /> Disponível hoje
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 pt-0">
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {available.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
            <div className="space-y-2 pt-2">
              {prompts.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => navigate('/assistente', { state: { prompt: p } })}
                  className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:border-brand/40 hover:bg-brand-soft"
                >
                  <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1">{p}</span>
                  <ArrowRight className="size-3.5 text-muted-foreground" />
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              Em implantação <Pill>roteiro</Pill>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {planned.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}

export function DrafterPage() {
  return (
    <ModulePage
      icon={PenLine}
      title="Redator Legislativo"
      description="Elaboração de proposições com base nos modelos e normas da instituição."
      available={[
        'Redação assistida de emendas orçamentárias com modelo oficial, exportação DOCX/PDF e validação.',
        'Consulta à Base Legislativa para fundamentar justificativas de outras proposições.',
      ]}
      planned={['Modelos oficiais de projetos de lei, requerimentos, indicações, moções e ofícios.', 'Emendas modificativas, aditivas e supressivas ao texto de projetos.', 'Verificação de técnica legislativa (LC nº 95/1998).']}
      prompts={['Preciso elaborar um requerimento de informações sobre a manutenção das quadras esportivas.', 'Redija uma justificativa para uma emenda de apoio ao esporte comunitário.']}
    />
  )
}

export function LegalAdvisorPage() {
  return (
    <ModulePage
      icon={Scale}
      title="Consultor Jurídico"
      description="Análises preliminares de competência, iniciativa e compatibilidade normativa, sempre fundamentadas em documentos carregados."
      available={[
        'Pesquisa em linguagem natural na Lei Orgânica, Constituição Estadual, Regimento, LDO e demais normas da Base Legislativa, com citação de página.',
        'Identificação de regras orçamentárias aplicáveis às emendas (regras ativas da instituição).',
      ]}
      planned={['Análise preliminar de constitucionalidade e de iniciativa reservada.', 'Mapa de compatibilidade entre normas e alertas de revogação.', 'Relatório de riscos jurídicos exportável.']}
      prompts={['Quais despesas não podem ser anuladas para custear emendas segundo as normas da Casa?', 'O que a Lei Orgânica diz sobre o limite das emendas individuais?']}
    />
  )
}

export function OfficeManagementPage() {
  const ws = useRequiredWorkspace()
  const { user } = useAuth()
  const recent = useQuery({
    queryKey: ['office-overview', ws.office?.id, user?.id],
    enabled: Boolean(ws.office),
    queryFn: async () => {
      const [amendments, conversations] = await Promise.all([
        supabase.from('amendments').select('id, title, status, total_amount, updated_at').eq('office_id', ws.office!.id).order('updated_at', { ascending: false }).limit(10),
        supabase.from('ai_conversations').select('id, title, updated_at').eq('office_id', ws.office!.id).eq('user_id', user!.id).order('updated_at', { ascending: false }).limit(6),
      ])
      return {
        amendments: unwrap<Array<{ id: string; title: string; status: AmendmentStatus; total_amount: string; updated_at: string }>>(amendments),
        conversations: unwrap<Array<{ id: string; title: string; updated_at: string }>>(conversations),
      }
    },
  })
  return (
    <PageContainer>
      <PageHeader eyebrow="Módulo" title="Gestão de Gabinete" description={ws.office ? ws.office.name : 'Selecione um gabinete para acompanhar a produção.'} />
      {!ws.office ? (
        <p className="text-sm text-muted-foreground">Você não integra um gabinete nesta instituição.</p>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <FileText className="size-4" /> Produção recente do gabinete
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {recent.isLoading ? (
                <Skeleton className="h-40" />
              ) : (recent.data?.amendments ?? []).length === 0 ? (
                <p className="py-4 text-sm text-muted-foreground">Nenhuma emenda registrada.</p>
              ) : (
                <ul className="divide-y">
                  {recent.data!.amendments.map((a) => (
                    <li key={a.id}>
                      <Link to={`/emendas/${a.id}`} className="flex items-center gap-3 py-2.5 text-sm hover:text-brand">
                        <span className="min-w-0 flex-1 truncate">{a.title}</span>
                        <span className="text-xs text-muted-foreground tabular">{money(a.total_amount)}</span>
                        <AmendmentStatusBadge status={a.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <MessagesSquare className="size-4" /> Suas conversas neste gabinete
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                {(recent.data?.conversations ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem conversas.</p>
                ) : (
                  <ul className="space-y-1">
                    {recent.data!.conversations.map((c) => (
                      <li key={c.id}>
                        <Link to={`/assistente/${c.id}`} className="flex justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent">
                          <span className="truncate">{c.title}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(c.updated_at)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Briefcase className="size-4" /> Em implantação
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 text-sm text-muted-foreground">
                Organização de demandas, tarefas por assessor e histórico de atuação parlamentar.
                <div className="mt-3">
                  <Button asChild variant="outline" size="sm">
                    <Link to="/emendas">Ver emendas do gabinete</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </PageContainer>
  )
}
