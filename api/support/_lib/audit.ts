import { getSQL } from './db.js'

export type AuditAction =
  | 'login' | 'logout' | 'sa.login'
  | 'org.create' | 'org.update' | 'org.deactivate'
  | 'agent.create' | 'agent.update' | 'agent.delete'
  | 'channel.create' | 'channel.update' | 'channel.delete'
  | 'case.create' | 'case.update' | 'case.resolve'
  | 'message.send' | 'message.delete'
  | 'broadcast.send' | 'broadcast.delete'
  | 'settings.update'
  | 'webhook.setup' | 'webhook.remove'
  | 'invite.create'
  | 'register.otp' | 'register.complete'

interface AuditEntry {
  orgId: string
  agentId?: string | null
  action: AuditAction
  targetType?: string
  targetId?: string
  details?: Record<string, any>
  ip?: string
}

export async function writeAuditLog(entry: AuditEntry): Promise<void> {
  try {
    const sql = getSQL()
    await sql`
      INSERT INTO support_audit_log (
        id, org_id, agent_id, action, target_type, target_id, details, ip, created_at
      ) VALUES (
        ${'audit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6)},
        ${entry.orgId},
        ${entry.agentId || null},
        ${entry.action},
        ${entry.targetType || null},
        ${entry.targetId || null},
        ${entry.details ? JSON.stringify(entry.details) : null}::jsonb,
        ${entry.ip || null},
        NOW()
      )
    `
  } catch (e) {
    console.error('[Audit] Failed to write:', e)
  }
}

export function getClientIP(req: Request): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || req.headers.get('x-real-ip')
    || 'unknown'
}
