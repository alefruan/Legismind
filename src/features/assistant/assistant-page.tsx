import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, ArrowUp, History, Info, MessageSquarePlus, Square, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { LogoMark } from '@/components/brand/logo'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { Markdown } from '@/components/common/markdown'
import { ErrorState } from '@/components/common/states'
import type { AiConversationRow, AiMessageRow } from '@shared/types/db'
import { supabase, unwrap } from '@/lib/supabase'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/providers/auth'
import { useRequiredWorkspace } from '@/providers/workspace'
import { cn } from '@/lib/utils'
import { ToolActivity } from './tool-cards'
import { fromStored, useChat, type ChatMessage } from './use-chat'

const starters = [
  'Quero destinar R$ 150 mil para uma ONG realizar atividades esportivas para crianças e adolescentes.',
  'Quais dotações de assistência à criança e ao adolescente existem no orçamento?',
  'O que a LDO diz sobre transferências a organizações da sociedade civil?',
  'Quais despesas não podem ser anuladas para custear emendas?',
]

function ConversationList({ activeId, onSelect }: { activeId: string | null; onSelect: (id: string | null) => void }) {
  const ws = useRequiredWorkspace()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const conversations = useQuery({
    queryKey: ['conversations', ws.organization.id, user?.id],
    queryFn: async () =>
      unwrap<AiConversationRow[]>(
        await supabase.from('ai_conversations').select('*').eq('organization_id', ws.organization.id).is('archived_at', null).order('updated_at', { ascending: false }).limit(50),
      ),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('ai_conversations').delete().eq('id', id)),
    onSuccess: (_, id) => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] })
      if (id === activeId) onSelect(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button variant="outline" className="w-full justify-start" onClick={() => onSelect(null)}>
          <MessageSquarePlus /> Nova conversa
        </Button>
      </div>
      <ScrollArea className="flex-1 px-2 pb-3">
        {conversations.isLoading ? (
          <div className="space-y-2 px-1">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10" />
            ))}
          </div>
        ) : (conversations.data ?? []).length === 0 ? (
          <p className="px-3 py-4 text-xs text-muted-foreground">Suas conversas aparecerão aqui.</p>
        ) : (
          <ul className="space-y-0.5">
            {conversations.data!.map((c) => (
              <li key={c.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(c.id)}
                  className={cn('w-full rounded-md px-3 py-2 pr-8 text-left transition-colors hover:bg-accent', c.id === activeId && 'bg-accent')}
                >
                  <span className="block truncate text-[13px]">{c.title}</span>
                  <span className="block text-[11px] text-muted-foreground">{timeAgo(c.updated_at)}</span>
                </button>
                <button
                  type="button"
                  onClick={() => remove.mutate(c.id)}
                  className="absolute top-2 right-1.5 hidden rounded p-1 text-muted-foreground hover:bg-background hover:text-danger group-hover:block focus-visible:block"
                  aria-label="Excluir conversa"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </div>
  )
}

function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">{text}</div>
      </div>
    )
  }
  const empty = message.parts.length === 0
  return (
    <div className="flex gap-3">
      <LogoMark className="mt-0.5 size-7" />
      <div className="min-w-0 flex-1 space-y-3">
        {empty && message.streaming && (
          <div className="flex items-center gap-1.5 pt-1.5" aria-label="Pensando">
            {[0, 1, 2].map((i) => (
              <span key={i} className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" style={{ animationDelay: `${i * 150}ms` }} />
            ))}
          </div>
        )}
        {message.parts.map((part, i) => {
          if (part.type === 'tool') return <ToolActivity key={part.record.id + i} record={part.record} />
          if (part.type === 'notice') {
            return (
              <p key={i} className={cn('flex items-start gap-2 rounded-md px-3 py-2 text-xs', part.level === 'warning' ? 'bg-warning-soft text-warning' : 'bg-muted text-muted-foreground')}>
                <Info className="mt-0.5 size-3.5 shrink-0" /> {part.text}
              </p>
            )
          }
          return part.text.trim() ? <Markdown key={i} text={part.text} /> : null
        })}
        {message.error && (
          <p className="flex items-start gap-2 rounded-md bg-danger-soft px-3 py-2 text-xs text-danger">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {message.error}
          </p>
        )}
      </div>
    </div>
  )
}

export function AssistantPage() {
  const ws = useRequiredWorkspace()
  const params = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const conversationId = params.conversationId ?? null
  const [input, setInput] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const startedFromState = useRef(false)
  const ownConversation = useRef<string | null>(null)

  const chat = useChat({
    organizationId: ws.organization.id,
    officeId: ws.office?.id ?? null,
    fiscalYearId: ws.fiscalYear?.id ?? null,
    conversationId,
    onConversation: (id) => {
      ownConversation.current = id
      navigate(`/assistente/${id}`, { replace: true })
    },
  })

  const stored = useQuery({
    queryKey: ['conversation-messages', conversationId],
    enabled: Boolean(conversationId) && ownConversation.current !== conversationId,
    queryFn: async () =>
      unwrap<AiMessageRow[]>(
        await supabase.from('ai_messages').select('id, conversation_id, role, content, blocks, model, created_at').eq('conversation_id', conversationId!).order('created_at'),
      ),
  })

  const { setMessages } = chat
  useEffect(() => {
    // Só reage à troca de conversa (o envio em si não altera conversationId até o servidor criar a conversa).
    if (!conversationId) {
      setMessages([])
      ownConversation.current = null
      return
    }
    if (ownConversation.current === conversationId) return
    if (stored.data) setMessages(fromStored(stored.data))
  }, [conversationId, stored.data, setMessages])

  // Pedido vindo do painel inicial ("O que você deseja fazer hoje?")
  const { send } = chat
  useEffect(() => {
    const prompt = (location.state as { prompt?: string } | null)?.prompt
    if (prompt && !startedFromState.current) {
      startedFromState.current = true
      navigate(location.pathname, { replace: true, state: null })
      void send(prompt)
    }
  }, [location.state, location.pathname, navigate, send])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [chat.messages])

  const submit = () => {
    if (!input.trim() || chat.streaming) return
    void chat.send(input)
    setInput('')
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const selectConversation = (id: string | null) => {
    setHistoryOpen(false)
    if (chat.streaming) chat.stop()
    navigate(id ? `/assistente/${id}` : '/assistente')
  }

  const isEmpty = chat.messages.length === 0 && !stored.isLoading

  return (
    <div className="flex h-[calc(100svh-3.5rem)]">
      <aside className="hidden w-64 shrink-0 border-r xl:block">
        <ConversationList activeId={conversationId} onSelect={selectConversation} />
      </aside>
      <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
        <SheetContent side="left" className="w-80 p-0">
          <SheetHeader className="border-b">
            <SheetTitle>Conversas</SheetTitle>
          </SheetHeader>
          <ConversationList activeId={conversationId} onSelect={selectConversation} />
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b px-4 py-2 xl:hidden">
          <Button variant="ghost" size="sm" onClick={() => setHistoryOpen(true)}>
            <History /> Conversas
          </Button>
          <Button variant="ghost" size="sm" onClick={() => selectConversation(null)}>
            <MessageSquarePlus /> Nova
          </Button>
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
            {stored.error && <ErrorState error={stored.error} onRetry={() => stored.refetch()} />}
            {stored.isLoading && conversationId && (
              <div className="space-y-4">
                <Skeleton className="ml-auto h-10 w-2/3" />
                <Skeleton className="h-24 w-full" />
              </div>
            )}
            {isEmpty ? (
              <div className="flex flex-col items-center pt-10 text-center sm:pt-16">
                <LogoMark className="size-11" />
                <h1 className="mt-5 text-xl font-semibold tracking-tight">Assistente LegisMind</h1>
                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                  Descreva o que deseja realizar. Consulto o orçamento e a Base Legislativa de {ws.organization.short_name ?? ws.organization.name}, proponho a
                  emenda e executo a validação técnica.
                </p>
                {!ws.office && (
                  <p className="mt-4 rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
                    Você não integra um gabinete: é possível consultar dados, mas não criar emendas.
                  </p>
                )}
                <div className="mt-8 grid w-full gap-2 sm:grid-cols-2">
                  {starters.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void chat.send(s)}
                      className="rounded-lg border p-3 text-left text-[13px] leading-snug transition-colors hover:border-brand/40 hover:bg-brand-soft"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                {chat.messages.map((m) => (
                  <MessageView key={m.id} message={m} />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="border-t bg-background">
          <div className="mx-auto w-full max-w-3xl px-4 py-3 sm:px-6">
            <form
              onSubmit={(e) => {
                e.preventDefault()
                submit()
              }}
              className="relative"
            >
              <Textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                  }
                }}
                rows={2}
                maxLength={8000}
                placeholder="Peça uma emenda, consulte dotações ou solicite ajustes em linguagem natural…"
                className="max-h-48 min-h-14 resize-none pr-14"
                aria-label="Mensagem para o assistente"
              />
              {chat.streaming ? (
                <Button type="button" size="icon" variant="secondary" className="absolute right-2.5 bottom-2.5" onClick={chat.stop} aria-label="Interromper">
                  <Square className="fill-current" />
                </Button>
              ) : (
                <Button type="submit" size="icon" className="absolute right-2.5 bottom-2.5" disabled={!input.trim()} aria-label="Enviar">
                  <ArrowUp />
                </Button>
              )}
            </form>
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Classificações e valores vêm dos dados oficiais carregados; interpretações da IA podem conter erros. Confira a minuta e o{' '}
              <Link to="/emendas" className="underline-offset-2 hover:underline">
                relatório de validação
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
