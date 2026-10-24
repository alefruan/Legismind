import { HttpError, badRequest, toHttpError } from './errors.js'

const baseHeaders: Record<string, string> = {
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { ...baseHeaders, 'content-type': 'application/json; charset=utf-8', ...(init.headers as Record<string, string>) },
  })
}

export function errorResponse(error: unknown): Response {
  const httpError = toHttpError(error)
  if (httpError.status >= 500) {
    console.error('[api]', httpError.code, error)
  }
  return json({ error: { code: httpError.code, message: httpError.message, details: httpError.details } }, { status: httpError.status })
}

export function file(bytes: Uint8Array, contentType: string, fileName: string): Response {
  return new Response(new Uint8Array(bytes), {
    headers: {
      ...baseHeaders,
      'content-type': contentType,
      'content-disposition': `attachment; filename="${fileName.replace(/[^\w.-]+/g, '_')}"`,
    },
  })
}

/** Stream de Server-Sent Events. */
export function sse(run: (send: (event: unknown) => void, signal: AbortSignal) => Promise<void>, signal: AbortSignal): Response {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false
      const send = (event: unknown) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
        } catch {
          closed = true
        }
      }
      const heartbeat = setInterval(() => {
        if (!closed) {
          try {
            controller.enqueue(encoder.encode(': ping\n\n'))
          } catch {
            closed = true
          }
        }
      }, 15_000)
      try {
        await run(send, signal)
      } catch (error) {
        const httpError = toHttpError(error)
        if (httpError.status >= 500) console.error('[sse]', error)
        send({ type: 'error', code: httpError.code, message: httpError.message })
      } finally {
        clearInterval(heartbeat)
        closed = true
        try {
          controller.close()
        } catch {
          // já fechado pelo cliente
        }
      }
    },
  })
  return new Response(stream, {
    headers: {
      ...baseHeaders,
      'content-type': 'text/event-stream; charset=utf-8',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  })
}

export async function readJson<T = unknown>(request: Request, maxBytes = 256 * 1024): Promise<T> {
  const tooLarge = new HttpError(413, 'payload_too_large', 'Conteúdo da requisição excede o limite permitido.')
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > maxBytes) throw tooLarge
  const text = await request.text()
  if (text.length > maxBytes) throw tooLarge
  if (!text) return {} as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw badRequest('JSON inválido no corpo da requisição.')
  }
}
