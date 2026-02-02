/**
 * Centralized sender identification logic
 * Determines if sender is employee (support/team) or client
 * 
 * Identification methods:
 * 1. By telegram_id - check support_agents and crm_managers
 * 2. By username - check support_agents and crm_managers
 * 3. By name patterns - "delever support", "support bot", etc.
 */

export interface SenderIdentification {
  role: 'client' | 'support' | 'team'
  agentId: string | null
  source: 'telegram_id' | 'username' | 'name_pattern' | 'default'
}

export interface IdentifyParams {
  username: string | null
  telegramId: number | string | null
  senderName?: string
}

/**
 * Identify sender role based on telegram_id, username, or name patterns
 */
export async function identifySender(
  sql: any,
  params: IdentifyParams
): Promise<SenderIdentification> {
  const { username, telegramId, senderName } = params
  
  // 1. Check by name patterns first (quick check)
  const nameLower = (senderName || '').toLowerCase()
  if (
    nameLower.includes('delever support') ||
    nameLower.includes('delever sales') ||
    nameLower.includes('support bot') ||
    nameLower === 'support'
  ) {
    return { role: 'support', agentId: null, source: 'name_pattern' }
  }

  // 2. Check by telegram_id (most reliable for employees using Telegram)
  if (telegramId) {
    const telegramIdStr = String(telegramId)
    
    // Check support_agents by telegram_id
    try {
      const agentByTgId = await sql`
        SELECT id, role FROM support_agents 
        WHERE telegram_id = ${telegramIdStr}
        LIMIT 1
      `
      if (agentByTgId[0]) {
        return { 
          role: 'support', 
          agentId: agentByTgId[0].id, 
          source: 'telegram_id' 
        }
      }
    } catch (e) {
      console.error('Error checking support_agents by telegram_id:', e)
    }

    // Check crm_managers by telegram_id
    try {
      const managerByTgId = await sql`
        SELECT id, role FROM crm_managers 
        WHERE telegram_id = ${telegramIdStr}
        LIMIT 1
      `
      if (managerByTgId[0]) {
        const isSupport = ['support', 'cs', 'customer_success'].includes(
          managerByTgId[0].role?.toLowerCase() || ''
        )
        return {
          role: isSupport ? 'support' : 'team',
          agentId: managerByTgId[0].id,
          source: 'telegram_id'
        }
      }
    } catch (e) {
      console.error('Error checking crm_managers by telegram_id:', e)
    }
  }

  // 3. Check by username
  if (username) {
    const usernameClean = username.replace('@', '')
    const usernameWithAt = '@' + usernameClean
    
    // Check crm_managers by username
    try {
      const managerByUsername = await sql`
        SELECT id, role FROM crm_managers 
        WHERE telegram_username = ${usernameClean} 
           OR telegram_username = ${usernameWithAt}
        LIMIT 1
      `
      if (managerByUsername[0]) {
        const isSupport = ['support', 'cs', 'customer_success'].includes(
          managerByUsername[0].role?.toLowerCase() || ''
        )
        return {
          role: isSupport ? 'support' : 'team',
          agentId: managerByUsername[0].id,
          source: 'username'
        }
      }
    } catch (e) {
      console.error('Error checking crm_managers by username:', e)
    }

    // Check support_agents by username
    try {
      const agentByUsername = await sql`
        SELECT id FROM support_agents 
        WHERE username = ${usernameClean} 
           OR username = ${usernameWithAt}
        LIMIT 1
      `
      if (agentByUsername[0]) {
        return {
          role: 'support',
          agentId: agentByUsername[0].id,
          source: 'username'
        }
      }
    } catch (e) {
      console.error('Error checking support_agents by username:', e)
    }
  }

  // 4. Default: client
  return { role: 'client', agentId: null, source: 'default' }
}

/**
 * Auto-bind telegram_id to agent if not already set
 * Called when employee replies from Telegram
 */
export async function autoBindTelegramId(
  sql: any,
  agentId: string,
  telegramId: number | string
): Promise<boolean> {
  if (!agentId || !telegramId) return false
  
  const telegramIdStr = String(telegramId)
  
  try {
    // Update support_agents if telegram_id not set
    const result = await sql`
      UPDATE support_agents 
      SET telegram_id = ${telegramIdStr}
      WHERE id = ${agentId} 
        AND (telegram_id IS NULL OR telegram_id = '')
      RETURNING id
    `
    
    if (result[0]) {
      console.log(`Auto-bound telegram_id ${telegramIdStr} to agent ${agentId}`)
      return true
    }
    
    // Also try crm_managers
    const managerResult = await sql`
      UPDATE crm_managers 
      SET telegram_id = ${telegramIdStr}
      WHERE id = ${agentId} 
        AND (telegram_id IS NULL OR telegram_id = '')
      RETURNING id
    `
    
    if (managerResult[0]) {
      console.log(`Auto-bound telegram_id ${telegramIdStr} to manager ${agentId}`)
      return true
    }
    
    return false
  } catch (e) {
    console.error('Error auto-binding telegram_id:', e)
    return false
  }
}

/**
 * Mark channel as read when employee responds
 * Called after employee message is saved
 */
export async function markChannelReadOnReply(
  sql: any,
  channelId: string
): Promise<{ updatedMessages: number }> {
  if (!channelId) return { updatedMessages: 0 }
  
  try {
    // Mark all unread client messages as read
    const result = await sql`
      UPDATE support_messages 
      SET is_read = true, read_at = NOW()
      WHERE channel_id = ${channelId} 
        AND is_read = false 
        AND is_from_client = true
      RETURNING id
    `
    
    const updatedCount = result.length
    
    // Reset channel unread count
    await sql`
      UPDATE support_channels 
      SET unread_count = 0 
      WHERE id = ${channelId}
    `
    
    if (updatedCount > 0) {
      console.log(`Auto-marked ${updatedCount} messages as read in channel ${channelId}`)
    }
    
    return { updatedMessages: updatedCount }
  } catch (e) {
    console.error('Error marking channel as read on reply:', e)
    return { updatedMessages: 0 }
  }
}
