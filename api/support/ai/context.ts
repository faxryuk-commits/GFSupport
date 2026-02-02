import { neon } from '@neondatabase/serverless'

export const config = {
  runtime: 'edge',
}

function getSQL() {
  const connectionString = process.env.POSTGRES_URL || process.env.NEON_URL || process.env.DATABASE_URL
  if (!connectionString) throw new Error('Database connection string not found')
  return neon(connectionString)
}

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}

interface MessageContext {
  id: string
  senderName: string
  senderRole: string
  text: string
  sentiment: string
  intent: string
  urgency: number
  suggestion: string | null
  createdAt: string
}

interface ChannelContext {
  summary: string
  currentStatus: string
  mainIssues: string[]
  pendingActions: string[]
  suggestedResponse: string | null
  sentiment: 'positive' | 'neutral' | 'negative' | 'escalating'
  urgencyLevel: number
  commitments: Array<{
    text: string
    deadline: string | null
    status: string
  }>
  keyTopics: string[]
  clientWaitingTime: number | null
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const url = new URL(req.url)
  const channelId = url.searchParams.get('channelId')

  if (!channelId) {
    return json({ error: 'channelId is required' }, 400)
  }

  try {
    // Get channel info
    const channels = await sql`
      SELECT id, name, awaiting_reply, last_client_message_at, last_team_message_at
      FROM support_channels WHERE id = ${channelId}
    `
    
    if (channels.length === 0) {
      return json({ error: 'Channel not found' }, 404)
    }
    
    const channel = channels[0]

    // Get recent messages for context (last 50)
    const messages = await sql`
      SELECT 
        id, sender_name, sender_role, text_content, transcript,
        ai_sentiment, ai_intent, ai_urgency, ai_suggestion, ai_summary,
        created_at
      FROM support_messages
      WHERE channel_id = ${channelId}
      ORDER BY created_at DESC
      LIMIT 50
    `

    // Get active commitments/reminders
    const reminders = await sql`
      SELECT commitment_text, deadline, status
      FROM support_reminders
      WHERE channel_id = ${channelId} AND status = 'active'
      ORDER BY COALESCE(deadline, created_at) ASC
    `

    // Calculate client waiting time
    let clientWaitingTime: number | null = null
    if (channel.awaiting_reply && channel.last_client_message_at) {
      const waitMs = Date.now() - new Date(channel.last_client_message_at).getTime()
      clientWaitingTime = Math.round(waitMs / (1000 * 60)) // minutes
    }

    // Build fallback summary from messages
    const clientMessages = messages.filter((m: any) => m.sender_role === 'client')
    const lastClientMsg = clientMessages[0]
    const fallbackSummary = lastClientMsg 
      ? `Последнее сообщение от ${lastClientMsg.sender_name}: "${(lastClientMsg.text_content || lastClientMsg.transcript || '').slice(0, 100)}..."`
      : `${messages.length} сообщений в диалоге`

    // Analyze context with AI
    const apiKey = process.env.OPENAI_API_KEY
    let aiContext: ChannelContext | null = null

    if (apiKey && messages.length > 0) {
      const messagesSummary = messages.slice(0, 15).map((m: any) => ({
        sender: m.sender_name,
        role: m.sender_role,
        text: (m.text_content || m.transcript || '').slice(0, 150),
        sentiment: m.ai_sentiment,
        urgency: m.ai_urgency
      }))

      try {
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `Ты AI-помощник для операторов поддержки Delever. Анализируй историю переписки и давай полезные рекомендации на русском языке.

Ответь JSON:
{
  "summary": "краткая сводка диалога на русском (2-3 предложения)",
  "currentStatus": "waiting_for_client или waiting_for_support или resolved или escalation_needed",
  "mainIssues": ["список основных проблем/вопросов клиента на русском"],
  "pendingActions": ["что нужно сделать оператору на русском"],
  "suggestedResponse": "рекомендованный ответ клиенту на русском (если нужен) или null",
  "sentiment": "positive или neutral или negative или escalating",
  "urgencyLevel": 3,
  "keyTopics": ["ключевые темы на русском"]
}

ВАЖНО: Отвечай ТОЛЬКО валидным JSON без markdown.`
              },
              {
                role: 'user',
                content: `История сообщений:\n${JSON.stringify(messagesSummary, null, 2)}\n\nКлиент ждёт ответа: ${clientWaitingTime ? clientWaitingTime + ' минут' : 'нет'}`
              }
            ],
            temperature: 0.3,
            max_tokens: 600,
          }),
        })

        if (res.ok) {
          const data = await res.json()
          const content = data.choices?.[0]?.message?.content || ''
          
          // Clean markdown if present
          const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
          
          try {
            aiContext = JSON.parse(cleanContent)
          } catch (parseErr) {
            console.error('Failed to parse AI context:', cleanContent.slice(0, 200))
          }
        } else {
          console.error('OpenAI API error:', res.status)
        }
      } catch (e) {
        console.error('AI context analysis failed:', e)
      }
    }

    // Build response with fallback
    const context: ChannelContext = {
      summary: aiContext?.summary || fallbackSummary,
      currentStatus: aiContext?.currentStatus || (channel.awaiting_reply ? 'waiting_for_support' : 'resolved'),
      mainIssues: aiContext?.mainIssues || [],
      pendingActions: aiContext?.pendingActions || [],
      suggestedResponse: aiContext?.suggestedResponse || null,
      sentiment: aiContext?.sentiment || 'neutral',
      urgencyLevel: aiContext?.urgencyLevel || Math.max(...messages.map((m: any) => m.ai_urgency || 0), 0),
      commitments: reminders.map((r: any) => ({
        text: r.commitment_text,
        deadline: r.deadline,
        status: r.status
      })),
      keyTopics: aiContext?.keyTopics || [],
      clientWaitingTime
    }

    // Recent message suggestions
    const recentSuggestions = messages
      .filter((m: any) => m.ai_suggestion)
      .slice(0, 5)
      .map((m: any) => ({
        messageId: m.id,
        senderName: m.sender_name,
        suggestion: m.ai_suggestion,
        urgency: m.ai_urgency
      }))

    // Search for similar solutions if there are issues
    let similarSolutions: any[] = []
    if (aiContext?.mainIssues && aiContext.mainIssues.length > 0) {
      try {
        // Get the main problem description
        const problemText = aiContext.mainIssues.join(' ')
        
        // Search in solutions database
        const solutions = await sql`
          SELECT id, category, solution_text, solution_steps, success_score, is_verified
          FROM support_solutions
          WHERE is_active = true
          ORDER BY success_score DESC
          LIMIT 20
        `
        
        // Simple keyword matching for now (embeddings search would be called separately)
        const problemLower = problemText.toLowerCase()
        similarSolutions = solutions
          .filter((s: any) => {
            const solutionText = (s.solution_text || '').toLowerCase()
            return problemLower.split(' ').some((word: string) => 
              word.length > 3 && solutionText.includes(word)
            )
          })
          .slice(0, 3)
          .map((s: any) => ({
            id: s.id,
            category: s.category,
            text: s.solution_text,
            steps: s.solution_steps,
            successScore: s.success_score,
            isVerified: s.is_verified
          }))
      } catch (e) {
        console.error('Solution search failed:', e)
      }
    }

    // Search knowledge base (GitBook docs) for relevant articles
    let knowledgeBaseArticles: any[] = []
    try {
      // Собираем ключевые слова для поиска
      const searchTerms: string[] = []
      
      // Добавляем keyTopics
      if (aiContext?.keyTopics) {
        searchTerms.push(...aiContext.keyTopics)
      }
      
      // Добавляем слова из mainIssues
      if (aiContext?.mainIssues) {
        aiContext.mainIssues.forEach((issue: string) => {
          const words = issue.split(/\s+/).filter((w: string) => w.length > 4)
          searchTerms.push(...words.slice(0, 3))
        })
      }
      
      // Добавляем слова из последнего сообщения клиента
      if (lastClientMsg) {
        const msgText = (lastClientMsg.text_content || lastClientMsg.transcript || '').toLowerCase()
        const msgWords = msgText.split(/\s+/).filter((w: string) => 
          w.length > 4 && 
          !['который', 'которые', 'нужно', 'можно', 'будет', 'через', 'после', 'когда', 'чтобы'].includes(w)
        )
        searchTerms.push(...msgWords.slice(0, 5))
      }
      
      // Уникальные термины
      const uniqueTerms = [...new Set(searchTerms.map(t => t.toLowerCase().trim()).filter(t => t.length > 2))]
      
      if (uniqueTerms.length > 0) {
        // Формируем поисковый запрос
        const searchQuery = uniqueTerms.slice(0, 5).join(' ')
        const searchPattern = `%${searchQuery}%`
        
        // Поиск в базе знаний
        const docs = await sql`
          SELECT 
            id, title, url, category,
            LEFT(content, 200) as excerpt,
            (
              CASE WHEN title ILIKE ${searchPattern} THEN 10 ELSE 0 END +
              CASE WHEN content ILIKE ${searchPattern} THEN 5 ELSE 0 END
            ) as relevance
          FROM support_docs
          WHERE 
            title ILIKE ${searchPattern}
            OR content ILIKE ${searchPattern}
            OR EXISTS (
              SELECT 1 FROM unnest(${uniqueTerms.map(t => `%${t}%`)}::text[]) AS pattern 
              WHERE title ILIKE pattern OR content ILIKE pattern
            )
          ORDER BY relevance DESC, title
          LIMIT 5
        `.catch(() => [])
        
        knowledgeBaseArticles = docs.map((doc: any) => ({
          id: doc.id,
          title: doc.title,
          url: doc.url,
          category: doc.category,
          excerpt: doc.excerpt ? doc.excerpt.replace(/\s+/g, ' ').trim() + '...' : '',
          relevance: doc.relevance || 0
        }))
      }
    } catch (e) {
      console.error('Knowledge base search failed:', e)
    }

    // Генерируем AI-подсказку с учётом базы знаний
    let aiSuggestionWithKB = aiContext?.suggestedResponse || null
    if (knowledgeBaseArticles.length > 0 && apiKey) {
      try {
        const kbContext = knowledgeBaseArticles.map(a => `- ${a.title}: ${a.excerpt}`).join('\n')
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `Ты AI-помощник поддержки Delever. На основе проблемы клиента и релевантных статей из базы знаний, дай краткую рекомендацию оператору на русском языке.`
              },
              {
                role: 'user',
                content: `Проблема клиента: ${aiContext?.mainIssues?.join(', ') || 'не определена'}

Релевантные статьи из базы знаний:
${kbContext}

Дай краткую рекомендацию (2-3 предложения) как решить проблему, опираясь на базу знаний.`
              }
            ],
            temperature: 0.3,
            max_tokens: 200,
          }),
        })
        
        if (res.ok) {
          const data = await res.json()
          const suggestion = data.choices?.[0]?.message?.content?.trim()
          if (suggestion) {
            aiSuggestionWithKB = suggestion
          }
        }
      } catch (e) {
        console.error('AI KB suggestion failed:', e)
      }
    }

    // Search for similar dialogs from learning database
    let similarDialogs: any[] = []
    try {
      const lastClientMsg = messages.find((m: any) => m.senderRole === 'client' && m.text)
      if (lastClientMsg?.text) {
        // Search in support_dialogs using simple keyword matching (embeddings created async)
        const searchTerms = lastClientMsg.text
          .toLowerCase()
          .replace(/[^\wа-яёўқғҳ\s]/gi, '')
          .split(/\s+/)
          .filter((w: string) => w.length > 3)
          .slice(0, 5)
        
        if (searchTerms.length > 0) {
          const searchPattern = `%${searchTerms.join('%')}%`
          const dialogs = await sql`
            SELECT 
              id, question_text, answer_text, answer_by, 
              was_helpful, confidence_score, used_count
            FROM support_dialogs
            WHERE is_active = true
              AND (was_helpful IS NULL OR was_helpful = true)
              AND (
                question_text ILIKE ${searchPattern}
                OR question_text ILIKE ${'%' + searchTerms[0] + '%'}
              )
            ORDER BY 
              confidence_score DESC,
              used_count DESC
            LIMIT 3
          `
          
          similarDialogs = dialogs.map((d: any) => ({
            id: d.id,
            question: d.question_text?.slice(0, 100) + (d.question_text?.length > 100 ? '...' : ''),
            answer: d.answer_text,
            answeredBy: d.answer_by,
            wasHelpful: d.was_helpful,
            confidence: d.confidence_score,
            usedCount: d.used_count
          }))
        }
      }
    } catch (e) {
      console.log('Similar dialogs search skipped:', e)
    }

    return json({
      channelId,
      channelName: channel.name,
      context: {
        ...context,
        suggestedResponse: aiSuggestionWithKB || context.suggestedResponse
      },
      recentSuggestions,
      similarSolutions,
      similarDialogs, // NEW: dialogs from learning database
      knowledgeBaseArticles,
      messagesAnalyzed: messages.length
    })

  } catch (e: any) {
    console.error('Context analysis error:', e)
    return json({ error: 'Failed to analyze context', details: e.message }, 500)
  }
}
