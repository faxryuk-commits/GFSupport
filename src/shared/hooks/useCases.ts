import { useState, useEffect, useCallback } from 'react'
import { fetchCases, updateCaseStatus, createCase } from '../api/cases'
import type { Case, CaseStatus } from '@/entities/case'

export function useCases(filters?: { channelId?: string; assignedTo?: string }) {
  const [cases, setCases] = useState<Case[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await fetchCases(filters)
      setCases(data.cases)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [filters?.channelId, filters?.assignedTo])

  useEffect(() => {
    load()
  }, [load])

  const changeStatus = useCallback(async (caseId: string, status: CaseStatus) => {
    const updatedCase = await updateCaseStatus(caseId, status)
    setCases(prev => prev.map(c => c.id === caseId ? updatedCase : c))
  }, [])

  const create = useCallback(async (data: {
    channelId: string
    title: string
    description?: string
    category?: string
    priority?: string
  }) => {
    const newCase = await createCase(data)
    setCases(prev => [newCase, ...prev])
    return newCase
  }, [])

  // Computed values
  const casesByStatus = useCallback((status: CaseStatus) => {
    return cases.filter(c => c.status === status)
  }, [cases])

  const openCases = cases.filter(c => c.status !== 'resolved')
  const urgentCases = cases.filter(c => c.priority === 'critical' || c.priority === 'high')

  return {
    cases,
    loading,
    error,
    refresh: load,
    changeStatus,
    create,
    casesByStatus,
    openCases,
    urgentCases
  }
}
