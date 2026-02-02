import { neon } from '@neondatabase/serverless'

export const config = { runtime: 'edge' }

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

// Sanitize personal data before storing
export function sanitizeText(text: string): string {
  if (!text) return ''
  
  return text
    // Phone numbers (international and local formats)
    .replace(/\+?[0-9]{10,15}/g, '[PHONE]')
    // Email addresses
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]')
    // Credit card numbers (16 digits with optional spaces/dashes)
    .replace(/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[CARD]')
    // Passport/ID numbers (common formats)
    .replace(/\b[A-Z]{2}\d{7}\b/gi, '[ID]')
    // IP addresses
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]')
    // URLs with tokens/keys
    .replace(/https?:\/\/[^\s]+(?:token|key|secret|password|auth)[^\s]*/gi, '[URL_WITH_SECRET]')
}

// Create hash for deduplication
export function createQuestionHash(text: string): string {
  // Normalize: lowercase, remove extra spaces, remove punctuation
  const normalized = text
    .toLowerCase()
    .replace(/[^\wа-яёўқғҳ\s]/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  
  // Simple hash function
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

// Detect language
export function detectLanguage(text: string): string {
  const cyrillicCount = (text.match(/[а-яёА-ЯЁ]/g) || []).length
  const latinCount = (text.match(/[a-zA-Z]/g) || []).length
  const uzbekCyrillicChars = (text.match(/[ўқғҳ]/gi) || []).length
  
  if (uzbekCyrillicChars > 0) return 'uz'
  if (cyrillicCount > latinCount * 2) return 'ru'
  if (latinCount > cyrillicCount * 2) return 'en'
  return 'ru' // default
}

// Create embedding using OpenAI
export async function createEmbedding(text: string): Promise<number[] | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY not configured')
    return null
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'text-embedding-ada-002',
        input: text.slice(0, 8000) // Limit to ~8000 chars
      })
    })

    if (!response.ok) {
      const error = await response.json()
      console.error('OpenAI embedding error:', error)
      return null
    }

    const data = await response.json()
    return data.data?.[0]?.embedding || null

  } catch (e) {
    console.error('Embedding creation failed:', e)
    return null
  }
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  try {
    const body = await req.json()
    const { text, sanitize = true } = body

    if (!text || typeof text !== 'string') {
      return json({ error: 'Text is required' }, 400)
    }

    // Sanitize if requested
    const processedText = sanitize ? sanitizeText(text) : text
    
    // Create embedding
    const embedding = await createEmbedding(processedText)
    
    if (!embedding) {
      return json({ error: 'Failed to create embedding' }, 500)
    }

    // Also return useful metadata
    const hash = createQuestionHash(processedText)
    const language = detectLanguage(text)

    return json({
      success: true,
      embedding,
      metadata: {
        hash,
        language,
        originalLength: text.length,
        sanitizedLength: processedText.length,
        dimensions: embedding.length
      }
    })

  } catch (e: any) {
    return json({ error: e.message || 'Server error' }, 500)
  }
}
