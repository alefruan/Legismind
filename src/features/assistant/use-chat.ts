import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { AssistantStreamEvent, ToolEventRecord } from '@shared/types/assistant'
import type { AiMessageRow } from '@shared/types/db'
import { streamAssistantChat } from '@/lib/api'
import type { LiveToolRecord } from './tool-cards'

export type MessagePart = { type: 'text'; text: string } | { type: 'tool'; record: LiveToolRecord } | { type: 'notice'; level: 'info' | 'warning'; text: string }

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: MessagePart[]
  streaming?: boolean
  error?: string | null
}

export function fromStored(rows: AiMessageRow[]): ChatMessage[] {
  return rows.map((row) => {
    const tools = (Array.isArray(row.blocks) ? (row.blocks as ToolEventRecord[]) : []).map<MessagePart>((record) => ({
      type: 'tool',
      record: { ...record, running: false },
    }))
    const parts: MessagePart[] = row.role === 'assistant' ? [...tools, { type: 'text', text: row.content }] : [{ type: 'text', text: row.content }]
    return { id: row.id, role: row.role, parts }
  })
}

interface UseChatOptions {
  organizationId: string
  officeId: string | null
  fiscalYearId: string | null
  conversationId: string | null
  onConversation: (id: string) => void
}

export function useChat(options: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const controller = useRef<AbortController | null>(null)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const queryClient = useQueryClient()

  useEffect(() => () => controller.current?.abort(), [])

  const updateAssistant = useCallback((id: string, fn: (m: ChatMessage) => ChatMessage) => {
    setMessages((list) => list.map((m) => (m.id === id ? fn(m) : m)))
  }, [])

  const send = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || streaming) return
      const userId = `u-${Date.now()}`
      const assistantId = `a-${Date.now()}`
      setMessages((list) => [
        ...list,
        { id: userId, role: 'user', parts: [{ type: 'text', text: content }] },
        { id: assistantId, role: 'assistant', parts: [], streaming: true },
      ])
      setStreaming(true)
      const abort = new AbortController()
      controller.current = abort

      const handle = (event: AssistantStreamEvent) => {
        switch (event.type) {
          case 'conversation':
            if (event.conversationId !== optionsRef.current.conversationId) optionsRef.current.onConversation(event.conversationId)
            break
          case 'text':
            updateAssistant(assistantId, (m) => {
              const parts = [...m.parts]
              const last = parts[parts.length - 1]
              if (last?.type === 'text') parts[parts.length - 1] = { type: 'text', text: last.text + event.delta }
              else parts.push({ type: 'text', text: event.delta })
              return { ...m, parts }
            })
            break
          case 'tool_start':
            updateAssistant(assistantId, (m) => ({ ...m, parts: [...m.parts, { type: 'tool', record: { id: event.id, name: event.name, label: event.label, running: true } }] }))
            break
          case 'tool_end':
            updateAssistant(assistantId, (m) => {
              const exists = m.parts.some((p) => p.type === 'tool' && p.record.id === event.id)
              const record: LiveToolRecord = { id: event.id, name: event.name, label: event.label, ok: event.ok, summary: event.summary, card: event.card, running: false }
              return {
                ...m,
                parts: exists ? m.parts.map((p) => (p.type === 'tool' && p.record.id === event.id ? { type: 'tool', record } : p)) : [...m.parts, { type: 'tool', record }],
              }
            })
            break
          case 'notice':
            updateAssistant(assistantId, (m) => ({ ...m, parts: [...m.parts, { type: 'notice', level: event.level, text: event.message }] }))
            break
          case 'error':
            updateAssistant(assistantId, (m) => ({ ...m, error: event.message }))
            break
          case 'done':
            break
        }
      }

      try {
        await streamAssistantChat(
          {
            organizationId: optionsRef.current.organizationId,
            officeId: optionsRef.current.officeId,
            fiscalYearId: optionsRef.current.fiscalYearId,
            conversationId: optionsRef.current.conversationId,
            message: content,
          },
          handle,
          abort.signal,
        )
      } catch (error) {
        if (!abort.signal.aborted) {
          updateAssistant(assistantId, (m) => ({ ...m, error: error instanceof Error ? error.message : 'Falha na comunicação com o servidor.' }))
        }
      } finally {
        updateAssistant(assistantId, (m) => ({
          ...m,
          streaming: false,
          parts: m.parts.map((p) => (p.type === 'tool' && p.record.running ? { type: 'tool', record: { ...p.record, running: false, ok: false, summary: 'Interrompido' } } : p)),
        }))
        setStreaming(false)
        controller.current = null
        void queryClient.invalidateQueries({ queryKey: ['conversations'] })
        void queryClient.invalidateQueries({ queryKey: ['amendments'] })
      }
    },
    [streaming, updateAssistant, queryClient],
  )

  const stop = useCallback(() => controller.current?.abort(), [])

  return { messages, setMessages, send, stop, streaming }
}
