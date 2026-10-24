import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProfileRow } from '@shared/types/db'
import { isSupabaseConfigured, supabase, unwrap } from '@/lib/supabase'

interface AuthContextValue {
  session: Session | null
  user: User | null
  profile: ProfileRow | null
  loading: boolean
  /** Sessão criada por link de recuperação de senha. */
  recovery: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [initializing, setInitializing] = useState(isSupabaseConfigured)
  const [recovery, setRecovery] = useState(false)
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!isSupabaseConfigured) return
    let active = true
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setInitializing(false)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'USER_UPDATED') setRecovery(false)
      if (event === 'SIGNED_OUT') {
        setRecovery(false)
        queryClient.clear()
      }
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [queryClient])

  const userId = session?.user.id
  const profileQuery = useQuery({
    queryKey: ['profile', userId],
    enabled: Boolean(userId),
    queryFn: async () => unwrap<ProfileRow | null>(await supabase.from('profiles').select('*').eq('id', userId!).maybeSingle()),
    staleTime: 60_000,
  })

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      user: session?.user ?? null,
      profile: profileQuery.data ?? null,
      loading: initializing || (Boolean(userId) && profileQuery.isLoading),
      recovery,
      refreshProfile: async () => {
        await queryClient.invalidateQueries({ queryKey: ['profile', userId] })
      },
      signOut: async () => {
        await supabase.auth.signOut()
        localStorage.removeItem('legismind.workspace')
      },
    }),
    [session, profileQuery.data, profileQuery.isLoading, initializing, userId, recovery, queryClient],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider')
  return ctx
}
