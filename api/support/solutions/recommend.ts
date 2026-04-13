import { getRequestOrgId } from '../lib/org.js'
import { getSQL, json } from '../lib/db.js'

export const config = {
  runtime: 'edge',
}

// Extract keywords from text for matching
function extractKeywords(text: string): string[] {
  if (!text) return []
  
  const stopWords = new Set([
    'и', 'в', 'на', 'с', 'по', 'для', 'от', 'что', 'как', 'не', 'это', 'у', 'за', 'к',
    'из', 'но', 'он', 'она', 'они', 'мы', 'вы', 'я', 'так', 'же', 'то', 'все', 'при',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has',
    'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might',
    'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'or', 'and', 'not'
  ])
  
  return text
    .toLowerCase()
    .replace(/[^\wа-яё\s]/gi, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 20)
}

// Calculate relevance score
function calculateRelevance(solution: any, keywords: string[], category: string | null): number {
  let score = 0
  
  // Category match (high weight)
  if (category && solution.category === category) {
    score += 30
  }
  
  // Keyword matches
  const solutionKeywords = solution.problem_keywords || []
  const keywordMatches = keywords.filter(k => 
    solutionKeywords.some((sk: string) => sk.includes(k) || k.includes(sk))
  ).length
  score += keywordMatches * 10
  
  // Pattern match in problem text
  if (solution.problem_pattern) {
    const patternWords = solution.problem_pattern.toLowerCase().split(/\s+/)
    const patternMatches = keywords.filter(k => patternWords.some((pw: string) => pw.includes(k))).length
    score += patternMatches * 5
  }
  
  // Success score weight
  score += (solution.success_score || 3) * 5
  
  // Usage frequency weight
  score += Math.min(solution.used_count || 0, 50) * 0.5
  
  // Helpful votes weight
  const helpfulRatio = solution.helpful_votes / Math.max(solution.helpful_votes + solution.not_helpful_votes, 1)
  score += helpfulRatio * 20
  
  // Verified bonus
  if (solution.is_verified) score += 15
  
  // Resolution time bonus (faster is better)
  if (solution.resolution_time_minutes && solution.resolution_time_minutes < 30) {
    score += 10
  }
  
  return Math.round(score)
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Org-Id',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401)
  }

  const sql = getSQL()
  const orgId = await getRequestOrgId(req)

  // GET - get recommendations based on query params
  if (req.method === 'GET') {
    const url = new URL(req.url)
    const problemText = url.searchParams.get('problem') || ''
    const category = url.searchParams.get('category')
    const channelId = url.searchParams.get('channelId')
    const limit = parseInt(url.searchParams.get('limit') || '5')

    try {
      // Get all active solutions
      const solutions = await sql`
        SELECT * FROM support_solutions 
        WHERE is_active = true AND org_id = ${orgId}
        ORDER BY used_count DESC, success_score DESC
        LIMIT 100
      `

      // Extract keywords from problem
      const keywords = extractKeywords(problemText)

      // Score and rank solutions
      const rankedSolutions = solutions
        .map((s: any) => ({
          ...s,
          relevanceScore: calculateRelevance(s, keywords, category),
          confidence: 0
        }))
        .filter((s: any) => s.relevanceScore > 20)
        .sort((a: any, b: any) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit)

      // Calculate confidence percentage
      const maxScore = rankedSolutions[0]?.relevanceScore || 100
      rankedSolutions.forEach((s: any) => {
        s.confidence = Math.min(99, Math.round((s.relevanceScore / maxScore) * 100))
      })

      // If no good matches, get top solutions by category
      if (rankedSolutions.length === 0 && category) {
        const categoryFallback = await sql`
          SELECT * FROM support_solutions 
          WHERE is_active = true AND category = ${category} AND org_id = ${orgId}
          ORDER BY used_count DESC, success_score DESC
          LIMIT ${limit}
        `
        return json({
          recommendations: categoryFallback.map((s: any) => ({
            id: s.id,
            category: s.category,
            solutionText: s.solution_text,
            solutionSteps: s.solution_steps,
            confidence: 40,
            usedCount: s.used_count,
            avgResolutionMinutes: s.resolution_time_minutes,
            isVerified: s.is_verified,
            helpfulRatio: s.helpful_votes / Math.max(s.helpful_votes + s.not_helpful_votes, 1),
          })),
          matchType: 'category_fallback',
          keywords,
        })
      }

      return json({
        recommendations: rankedSolutions.map((s: any) => ({
          id: s.id,
          category: s.category,
          subcategory: s.subcategory,
          problemPattern: s.problem_pattern,
          solutionText: s.solution_text,
          solutionSteps: s.solution_steps,
          confidence: s.confidence,
          relevanceScore: s.relevanceScore,
          usedCount: s.used_count,
          avgResolutionMinutes: s.resolution_time_minutes,
          isVerified: s.is_verified,
          helpfulRatio: Math.round((s.helpful_votes / Math.max(s.helpful_votes + s.not_helpful_votes, 1)) * 100),
        })),
        matchType: rankedSolutions.length > 0 ? 'keyword_match' : 'no_match',
        keywords,
        totalSolutions: solutions.length,
      })

    } catch (e: any) {
      return json({ error: 'Failed to get recommendations' }, 500)
    }
  }

  // POST - create new solution from resolved case
  if (req.method === 'POST') {
    try {
      const body = await req.json()
      const { caseId, category, subcategory, problemPattern, solutionText, solutionSteps, resolutionMinutes, createdBy } = body

      if (!solutionText) {
        return json({ error: 'Solution text is required' }, 400)
      }

      const solutionId = `sol_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
      const keywords = extractKeywords(problemPattern || solutionText)

      await sql`
        INSERT INTO support_solutions (
          id, case_id, category, subcategory, problem_keywords, problem_pattern,
          solution_text, solution_steps, resolution_time_minutes, created_by, org_id
        ) VALUES (
          ${solutionId},
          ${caseId || null},
          ${category || null},
          ${subcategory || null},
          ${keywords},
          ${problemPattern || null},
          ${solutionText},
          ${JSON.stringify(solutionSteps || [])},
          ${resolutionMinutes || null},
          ${createdBy || null},
          ${orgId}
        )
      `

      return json({
        success: true,
        solutionId,
        keywords,
        message: 'Solution added to knowledge base'
      })

    } catch (e: any) {
      return json({ error: 'Failed to create solution' }, 500)
    }
  }

  return json({ error: 'Method not allowed' }, 405)
}
