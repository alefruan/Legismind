import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/form'
import { isSupabaseConfigured, supabase } from '@/lib/supabase'
import { useAuth } from '@/providers/auth'
import { AuthLayout } from './auth-layout'

const schema = z.object({
  email: z.string().trim().email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe a senha.'),
})

export function LoginPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  if (session) return <Navigate to={from} replace />

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null)
    const { error: authError } = await supabase.auth.signInWithPassword(values)
    if (authError) {
      setError(/invalid/i.test(authError.message) ? 'E-mail ou senha incorretos.' : authError.message)
      return
    }
    navigate(from, { replace: true })
  })

  return (
    <AuthLayout
      title="Entrar no LegisMind"
      description="Acesse com o e-mail cadastrado pela sua instituição."
      footer={
        <>
          Não tem acesso? Solicite um convite ao administrador da sua Câmara ou Assembleia.
        </>
      }
    >
      {!isSupabaseConfigured && (
        <Alert className="mb-6 border-warning/40 bg-warning-soft">
          <AlertDescription className="text-xs">
            Supabase não configurado: defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> no arquivo <code>.env</code> (veja o README).
          </AlertDescription>
        </Alert>
      )}
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
          <Input id="email" type="email" autoComplete="email" autoFocus {...form.register('email')} aria-invalid={Boolean(form.formState.errors.email)} />
        </Field>
        <Field label="Senha" htmlFor="password" error={form.formState.errors.password?.message}>
          <div className="relative">
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              className="pr-10"
              {...form.register('password')}
              aria-invalid={Boolean(form.formState.errors.password)}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
              aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </Field>
        <div className="flex justify-end">
          <Link to="/recuperar-senha" className="text-xs font-medium text-brand hover:underline">
            Esqueci minha senha
          </Link>
        </div>
        {error && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={form.formState.isSubmitting || !isSupabaseConfigured}>
          {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
          Entrar
        </Button>
      </form>
    </AuthLayout>
  )
}
