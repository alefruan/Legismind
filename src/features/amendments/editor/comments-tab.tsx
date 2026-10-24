import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Loader2, MessageSquare, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ErrorState, LoadingRows } from '@/components/common/states'
import { supabase, unwrap } from '@/lib/supabase'
import { initials, timeAgo } from '@/lib/format'
import { useAuth } from '@/providers/auth'
import { cn } from '@/lib/utils'
import { amendmentKeys, type AmendmentDetail } from '../hooks'

interface CommentRow {
  id: string
  author_id: string
  body: string
  resolved: boolean
  created_at: string
}

export function CommentsTab({ amendment }: { amendment: AmendmentDetail }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [body, setBody] = useState('')
  const comments = useQuery({
    queryKey: amendmentKeys.comments(amendment.id),
    queryFn: async () => {
      const rows = unwrap<CommentRow[]>(await supabase.from('amendment_comments').select('id, author_id, body, resolved, created_at').eq('amendment_id', amendment.id).order('created_at'))
      const ids = [...new Set(rows.map((r) => r.author_id))]
      const profiles = ids.length
        ? unwrap<Array<{ id: string; full_name: string | null; display_name: string | null; email: string }>>(await supabase.from('profiles').select('id, full_name, display_name, email').in('id', ids))
        : []
      const names = new Map(profiles.map((p) => [p.id, p.display_name || p.full_name || p.email]))
      return rows.map((r) => ({ ...r, author: names.get(r.author_id) ?? 'Usuário' }))
    },
  })
  const invalidate = () => queryClient.invalidateQueries({ queryKey: amendmentKeys.comments(amendment.id) })

  const add = useMutation({
    mutationFn: async () => unwrap(await supabase.from('amendment_comments').insert({ amendment_id: amendment.id, organization_id: amendment.organization_id, body: body.trim() })),
    onSuccess: () => {
      setBody('')
      void invalidate()
    },
    onError: (e: Error) => toast.error(e.message),
  })
  const resolve = useMutation({
    mutationFn: async (c: CommentRow) => unwrap(await supabase.from('amendment_comments').update({ resolved: !c.resolved }).eq('id', c.id)),
    onSuccess: () => void invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('amendment_comments').delete().eq('id', id)),
    onSuccess: () => void invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="max-w-3xl space-y-6">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (body.trim()) add.mutate()
        }}
        className="space-y-2"
      >
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={5000} placeholder="Comentário interno visível a quem tem acesso a esta emenda (gabinete e revisores)." />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={!body.trim() || add.isPending}>
            {add.isPending && <Loader2 className="animate-spin" />} Comentar
          </Button>
        </div>
      </form>
      {comments.error ? (
        <ErrorState error={comments.error} onRetry={() => comments.refetch()} />
      ) : comments.isLoading ? (
        <LoadingRows rows={3} />
      ) : (comments.data ?? []).length === 0 ? (
        <EmptyState icon={MessageSquare} title="Sem comentários" description="Use os comentários para registrar orientações de revisão e decisões do gabinete." />
      ) : (
        <ul className="space-y-3">
          {comments.data!.map((c) => (
            <li key={c.id} className={cn('flex gap-3 rounded-lg border p-3', c.resolved && 'opacity-60')}>
              <Avatar className="size-8">
                <AvatarFallback className="text-[11px]">{initials(c.author)}</AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-medium">{c.author}</span>
                  <span className="text-muted-foreground">{timeAgo(c.created_at)}</span>
                  {c.resolved && <span className="text-success">resolvido</span>}
                </div>
                <p className="mt-1 text-sm whitespace-pre-wrap">{c.body}</p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="ghost" size="icon-xs" onClick={() => resolve.mutate(c)} aria-label={c.resolved ? 'Reabrir' : 'Marcar como resolvido'}>
                  <Check />
                </Button>
                {c.author_id === user?.id && (
                  <Button variant="ghost" size="icon-xs" onClick={() => remove.mutate(c.id)} aria-label="Excluir comentário">
                    <Trash2 />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
