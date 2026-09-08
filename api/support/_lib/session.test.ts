import { describe, it, expect } from 'vitest'
import { tokenHash, TOKEN_PREFIX } from './session.js'
import { normPhone } from './sales-schema.js'

/**
 * Две вещи, которые молча ломают систему изнутри: ключ входа и склейка
 * дублей. Первую проверяем на том, что в базе лежит отпечаток, а не сам
 * ключ; вторую — на том, что один номер в разных написаниях даёт один ключ.
 */

describe('отпечаток ключа входа', () => {
  it('один ключ — один отпечаток', async () => {
    const a = await tokenHash('gfs_abc')
    const b = await tokenHash('gfs_abc')
    expect(a).toBe(b)
  })

  it('разные ключи — разные отпечатки', async () => {
    expect(await tokenHash('gfs_abc')).not.toBe(await tokenHash('gfs_abd'))
  })

  it('по отпечатку не восстановить ключ', async () => {
    const h = await tokenHash('gfs_secret_value')
    expect(h).not.toContain('secret')
    expect(h.length).toBeGreaterThan(20)
  })

  it('у ключей входа свой признак — старые не спутать с новыми', () => {
    expect(TOKEN_PREFIX).toBe('gfs_')
    expect('agent_1772526727220_akc3'.startsWith(TOKEN_PREFIX)).toBe(false)
  })
})

describe('ключ склейки дублей по телефону', () => {
  it('один номер в разных написаниях — один ключ', () => {
    const forms = ['+998 90 123 45 67', '998901234567', '90 123 45 67', '(998) 90-123-45-67']
    expect(new Set(forms.map(normPhone)).size).toBe(1)
  })

  it('разные номера не склеиваются', () => {
    expect(normPhone('+998901234567')).not.toBe(normPhone('+998901234568'))
  })

  it('огрызок номера не даёт ключа — иначе склеятся чужие карточки', () => {
    expect(normPhone('12345')).toBeNull()
    expect(normPhone('')).toBeNull()
    expect(normPhone(null)).toBeNull()
  })
})
