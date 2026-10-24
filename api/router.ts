import { handleApiRequest } from '../server/http/router.js'

/**
 * Função serverless única da Vercel (assinatura Web por método HTTP).
 * O vercel.json reescreve /api/* para /api/router?__route=*, mantendo uma só
 * função implantada e as rotas organizadas em server/http/router.ts.
 */
const handler = (request: Request) => handleApiRequest(request)

export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
