import type { AssistantChatRequest, AssistantStreamEvent } from '@shared/types/assistant'
import { supabase } from './supabase'

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message)
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { authorization: `Bearer ${token}` } : {}
}

async function toApiError(response: Response) {
  let message = `Erro ${response.status}`
  let code: string | undefined
  try {
    const body = (await response.json()) as { error?: { message?: string; code?: string } }
    message = body.error?.message ?? message
    code = body.error?.code
  } catch {
    if (response.status === 404) message = 'Serviço de API indisponível. Verifique se o servidor está em execução.'
  }
  return new ApiError(message, response.status, code)
}

/** Chamada autenticada às funções do servidor (/api). */
export async function apiFetch<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await authHeader()), ...(init.headers as Record<string, string>) }
  let body = init.body
  if (init.json !== undefined) {
    headers['content-type'] = 'application/json'
    body = JSON.stringify(init.json)
  }
  const response = await fetch(`/api${path}`, { ...init, headers, body })
  if (!response.ok) throw await toApiError(response)
  return (await response.json()) as T
}

/** Baixa um arquivo gerado pelo servidor (DOCX/PDF). */
export async function apiDownload(path: string, fallbackName: string) {
  const response = await fetch(`/api${path}`, { headers: await authHeader() })
  if (!response.ok) throw await toApiError(response)
  const disposition = response.headers.get('content-disposition') ?? ''
  const match = /filename="([^"]+)"/.exec(disposition)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = match?.[1] ?? fallbackName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2_000)
}

/** Conversa com o assistente via Server-Sent Events. */
export async function streamAssistantChat(request: AssistantChatRequest, onEvent: (event: AssistantStreamEvent) => void, signal?: AbortSignal) {
  const response = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(await authHeader()) },
    body: JSON.stringify(request),
    signal,
  })
  if (!response.ok || !response.body) throw await toApiError(response)

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let separator = buffer.indexOf('\n\n')
    while (separator !== -1) {
      const raw = buffer.slice(0, separator)
      buffer = buffer.slice(separator + 2)
      const data = raw
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n')
      if (data) {
        try {
          onEvent(JSON.parse(data) as AssistantStreamEvent)
        } catch {
          // fragmento inválido: ignorado
        }
      }
      separator = buffer.indexOf('\n\n')
    }
  }
}
