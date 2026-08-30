const SALT = 'delever_salt_2024'

export async function hashPassword(password: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(password + SALT)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

function legacyHash(password: string): string {
  let hash = 0
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash
  }
  return `h${Math.abs(hash).toString(36)}${password.length}`
}

export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<{ valid: boolean; needsMigration: boolean }> {
  const sha256 = await hashPassword(password)
  if (storedHash === sha256) return { valid: true, needsMigration: false }

  const legacy = legacyHash(password)
  if (storedHash === legacy) return { valid: true, needsMigration: true }

  return { valid: false, needsMigration: false }
}
