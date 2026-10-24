import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/common/form'
import { FullPageLoader } from '@/components/common/states'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/providers/auth'
import { AuthLayout } from './auth-layout'

export const passwordSchema = z
  .string()
  .min(10, 'Use ao menos 10 caracteres.')
  .regex(/[A-Za-z]/, 'Inclua letras.')
  .regex(/\d/, 'Inclua números.')

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const form = useForm<{ email: string }>({ resolver: zodResolver(z.object({ email: z.string().trim().email('Informe um e-mail válido.') })) })

  const onSubmit = form.handleSubmit(async ({ email }) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/redefinir-senha` })
    if (error && !/rate/i.test(error.message)) {
      toast.error('Não foi possível enviar o e-mail. Tente novamente em instantes.')
      return
    }
    // Resposta idêntica para e-mails existentes ou não (evita enumeração de contas).
    setSent(true)
  })

  return (
    <AuthLayout
      title="Recuperar senha"
      description="Enviaremos um link para você definir uma nova senha."
      footer={
        <Link to="/login" className="font-medium text-brand hover:underline">
          Voltar ao login
        </Link>
      }
    >
      {sent ? (
        <div className="flex gap-3 rounded-lg border bg-success-soft p-4 text-sm">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          <p>Se o e-mail estiver cadastrado, você receberá as instruções em alguns minutos. Verifique também a caixa de spam.</p>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field label="E-mail" htmlFor="email" error={form.formState.errors.email?.message}>
            <Input id="email" type="email" autoComplete="email" autoFocus {...form.register('email')} />
          </Field>
          <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
            Enviar link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}

const newPasswordSchema = z
  .object({ password: passwordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { message: 'As senhas não coincidem.', path: ['confirm'] })

export function NewPasswordForm({ submitLabel, onDone }: { submitLabel: string; onDone: () => void }) {
  const form = useForm<z.infer<typeof newPasswordSchema>>({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: '', confirm: '' } })
  const onSubmit = form.handleSubmit(async ({ password }) => {
    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      toast.error(error.message)
      return
    }
    toast.success('Senha definida com sucesso.')
    onDone()
  })
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Nova senha" htmlFor="password" error={form.formState.errors.password?.message} hint="Mínimo de 10 caracteres, com letras e números.">
        <Input id="password" type="password" autoComplete="new-password" {...form.register('password')} />
      </Field>
      <Field label="Confirme a senha" htmlFor="confirm" error={form.formState.errors.confirm?.message}>
        <Input id="confirm" type="password" autoComplete="new-password" {...form.register('confirm')} />
      </Field>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Loader2 className="animate-spin" />}
        {submitLabel}
      </Button>
    </form>
  )
}

export function ResetPasswordPage() {
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  if (loading) return <FullPageLoader />
  if (!session) {
    return (
      <AuthLayout title="Link inválido ou expirado" description="Solicite um novo link de recuperação de senha.">
        <Button asChild className="w-full">
          <Link to="/recuperar-senha">Solicitar novo link</Link>
        </Button>
      </AuthLayout>
    )
  }
  return (
    <AuthLayout title="Definir nova senha" description={`Conta: ${session.user.email}`}>
      <NewPasswordForm submitLabel="Salvar nova senha" onDone={() => navigate('/', { replace: true })} />
    </AuthLayout>
  )
}
