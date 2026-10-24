import { ZodError } from 'zod'
import { ConfigError } from '../env.js'

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message)
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details)
export const unauthorized = (message = 'Sessão inválida ou expirada. Entre novamente.') => new HttpError(401, 'unauthorized', message)
export const forbidden = (message = 'Você não tem permissão para esta operação.') => new HttpError(403, 'forbidden', message)
export const notFound = (message = 'Registro não encontrado.') => new HttpError(404, 'not_found', message)
export const conflict = (message: string) => new HttpError(409, 'conflict', message)
export const tooManyRequests = (message = 'Muitas requisições. Aguarde alguns instantes.') => new HttpError(429, 'rate_limited', message)
export const serviceUnavailable = (message: string) => new HttpError(503, 'service_unavailable', message)

interface PostgrestLikeError {
  code?: string
  message?: string
  details?: string | null
  hint?: string | null
}

/** Converte erros do PostgREST/PostgreSQL em respostas HTTP com mensagens seguras. */
export function fromPostgrest(error: PostgrestLikeError): HttpError {
  const message = error.message ?? 'Erro no banco de dados.'
  switch (error.code) {
    case '42501':
      return forbidden(message.includes('permission denied') ? 'Você não tem permissão para esta operação.' : message)
    case 'P0002':
    case 'PGRST116':
      return notFound(message.startsWith('JSON object requested') ? 'Registro não encontrado.' : message)
    case 'P0001':
    case '22023':
      return new HttpError(422, 'business_rule', message)
    case '40001':
      return conflict(message)
    case '23505':
      return conflict('Registro duplicado.')
    case '23503':
      return new HttpError(422, 'invalid_reference', 'Referência inválida: o registro relacionado não existe, pertence a outra instituição ou a outro exercício.')
    case '23514':
      return new HttpError(422, 'constraint', 'Os dados informados violam uma regra de integridade.')
    default:
      return new HttpError(500, 'database_error', 'Erro ao acessar o banco de dados.', { code: error.code })
  }
}

export function toHttpError(error: unknown): HttpError {
  if (error instanceof HttpError) return error
  if (error instanceof ZodError) {
    return new HttpError(422, 'validation', 'Dados inválidos.', error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })))
  }
  if (error instanceof ConfigError) {
    return serviceUnavailable(`Serviço não configurado (${error.variable}). Consulte o README.`)
  }
  if (error && typeof error === 'object' && 'code' in error && 'message' in error && typeof (error as PostgrestLikeError).code === 'string') {
    return fromPostgrest(error as PostgrestLikeError)
  }
  return new HttpError(500, 'internal', 'Erro interno inesperado.')
}
