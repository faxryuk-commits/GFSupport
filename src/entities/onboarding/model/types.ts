export type ConnectionStatus = 'active' | 'paused' | 'frozen' | 'cancelled' | 'launched'
export type StageStatus = 'pending' | 'in_progress' | 'completed'
export type TaskStatus = 'pending' | 'in_progress' | 'waiting_client' | 'waiting_partner' | 'completed'

export interface TemplateRole {
  id: string
  name: string
  color: string
}

export interface TemplateStageItem {
  name: string
  role: string
}

export interface OnboardingTemplateStage {
  id: string
  templateId: string
  name: string
  sortOrder: number
  plannedDays: number
  defaultRole: string
  items: TemplateStageItem[]
}

export interface OnboardingTemplate {
  id: string
  name: string
  description: string
  totalDays: number
  roles: TemplateRole[]
  isActive: boolean
  stageCount?: number
  stages?: OnboardingTemplateStage[]
  createdAt: string
  updatedAt: string
}

export interface OnboardingTask {
  id: string
  stageId: string
  connectionId: string
  name: string
  assignedRole: string
  assignedAgentId: string | null
  assignedAgentName?: string
  status: TaskStatus
  note: string | null
  completedAt: string | null
  createdAt: string
}

export interface OnboardingStage {
  id: string
  connectionId: string
  templateStageId: string
  name: string
  sortOrder: number
  plannedDays: number
  assignedRole: string
  status: StageStatus
  startedAt: string | null
  completedAt: string | null
  tasks: OnboardingTask[]
  completedTasksCount?: number
  totalTasksCount?: number
}

export interface TeamAssignment {
  [roleId: string]: string  // roleId -> agentId
}

export interface OnboardingConnection {
  id: string
  clientName: string
  clientContact: string | null
  clientPhone: string | null
  templateId: string | null
  templateName?: string
  status: ConnectionStatus
  pauseReason: string | null
  managerId: string | null
  managerName?: string
  team: TeamAssignment
  currentStageId: string | null
  currentStageName?: string
  currentStageNumber?: number
  totalStages?: number
  completedStages?: number
  plannedDeadline: string | null
  startedAt: string
  completedAt: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
  // Computed fields from API
  daysOnStage?: number
  isOverdue?: boolean
  overdueBy?: number
  stageOverdue?: boolean
  ballHolder?: string
  ballHolderType?: 'us' | 'client' | 'partner'
  progress?: number
  stages?: OnboardingStage[]
}

export interface OnboardingComment {
  id: string
  connectionId: string
  agentId: string | null
  agentName?: string
  text: string
  isSystem: boolean
  createdAt: string
}

export interface NotificationRule {
  id: string
  eventType: string
  recipientType: string
  channel: string
  delayDays: number
  isActive: boolean
}

export interface SLARule {
  id: string
  triggerType: string
  delayDays: number
  action: string
  recipientType: string
  isActive: boolean
}

export interface OnboardingAnalytics {
  totalConnections: number
  avgLaunchDays: number
  onTimePercentage: number
  activeCount: number
  overdueCount: number
  pausedCount: number
  frozenCount: number
  byStage: Array<{
    name: string
    count: number
    avgDays: number
    plannedDays: number
  }>
  ballDistribution: {
    us: number
    client: number
    partner: number
  }
  bottlenecks: Array<{
    stageName: string
    avgDays: number
    plannedDays: number
    delayPercentage: number
    mainDelaySource: string
  }>
  agentEfficiency: Array<{
    agentId: string
    agentName: string
    connectionsCount: number
    avgDays: number
    onTimePercentage: number
  }>
}

export interface MyTask {
  id: string
  name: string
  status: TaskStatus
  note: string | null
  connectionId: string
  connectionName: string
  stageName: string
  stageStatus: StageStatus
  plannedDays: number
  daysWaiting: number
  isOverdue: boolean
  overdueBy: number
  managerName: string | null
  managerId: string | null
  urgency: 'overdue' | 'today' | 'upcoming'
}

export interface CreateConnectionData {
  clientName: string
  clientContact?: string
  clientPhone?: string
  templateId: string
  managerId?: string
  team?: TeamAssignment
  plannedDeadline?: string
}
