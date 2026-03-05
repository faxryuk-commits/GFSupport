/**
 * Unified case auto-detection logic for both Telegram and WhatsApp.
 * Determines whether a message should create a case and classifies
 * resolved-in-chat scenarios as shadow cases.
 */

const problemPatterns = /ishlamay|ишламай|не\s*работает|not\s*working|kelmay|келмай|не\s*приходит|xato|хато|ошибк|error|muammo|муаммо|проблем|buzil|бузил|сломал|broken|qotib|завис|stuck|сбой|failure|fail|crash|bajaril|бажарил|bog'lan|боглан|ulana|улана|yoqol|йокол|помогите|help|yordam/i
const urgentPatterns = /срочно|urgent|tez|тез|shoshilinch|asap|критич|critical|авария|emergency|зависло|down|offline|не\s*доступен|недоступен/i

export interface DetectionResult {
  shouldCreate: boolean
  priority: 'low' | 'medium' | 'high' | 'critical'
  isShadow: boolean
  reason: string
}

interface MessageContext {
  text: string
  isFromClient: boolean
  channelId: string
  aiIntent?: string
  aiUrgency?: number
  isProblem?: boolean
  senderRole?: string
}

export function detectProblem(text: string): boolean {
  return problemPatterns.test(text)
}

export function detectUrgent(text: string): boolean {
  return urgentPatterns.test(text)
}

export function determinePriority(text: string, aiUrgency?: number): 'low' | 'medium' | 'high' | 'critical' {
  if (aiUrgency && aiUrgency >= 5) return 'critical'
  if (urgentPatterns.test(text)) return 'high'
  if (aiUrgency && aiUrgency >= 4) return 'high'
  if (aiUrgency && aiUrgency >= 3) return 'medium'
  if (problemPatterns.test(text)) return 'medium'
  return 'low'
}

export async function shouldAutoCreateCase(
  sql: any,
  msg: MessageContext,
): Promise<DetectionResult> {
  const noCreate: DetectionResult = { shouldCreate: false, priority: 'low', isShadow: false, reason: '' }

  if (!msg.isFromClient || !msg.text || msg.text.length < 5) return noCreate

  const hasProblem = msg.isProblem || detectProblem(msg.text)
  const hasIntentProblem = msg.aiIntent === 'report_problem' || msg.aiIntent === 'complaint'

  if (!hasProblem && !hasIntentProblem) return noCreate

  // Don't create if there's already an active case in this channel (last 24h)
  try {
    const existing = await sql`
      SELECT id FROM support_cases 
      WHERE channel_id = ${msg.channelId} 
        AND status NOT IN ('resolved', 'closed', 'cancelled')
        AND created_at > NOW() - INTERVAL '24 hours'
      LIMIT 1
    `
    if (existing[0]) return noCreate
  } catch { /* skip */ }

  // Check if an agent already responded within 5 minutes (resolved-in-chat scenario)
  try {
    const recentAgentReply = await sql`
      SELECT id FROM support_messages 
      WHERE channel_id = ${msg.channelId}
        AND sender_role != 'client'
        AND created_at > NOW() - INTERVAL '5 minutes'
      LIMIT 1
    `
    if (recentAgentReply[0]) {
      return {
        shouldCreate: true,
        priority: determinePriority(msg.text, msg.aiUrgency),
        isShadow: true,
        reason: 'resolved_in_chat',
      }
    }
  } catch { /* skip */ }

  return {
    shouldCreate: true,
    priority: determinePriority(msg.text, msg.aiUrgency),
    isShadow: false,
    reason: hasProblem ? 'problem_detected' : 'ai_intent_problem',
  }
}

export function generateCaseId(): string {
  return `case_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
}

export async function getNextTicketNumber(sql: any): Promise<number> {
  try {
    const maxRow = await sql`SELECT COALESCE(MAX(ticket_number), 1000) as n FROM support_cases`
    return parseInt(maxRow[0]?.n || '1000') + 1
  } catch {
    return Math.floor(Date.now() / 1000) % 100000
  }
}
