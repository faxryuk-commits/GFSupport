import { Plus, Award } from 'lucide-react'

const mockTeamMetrics = {
  onlineNow: 3,
  totalAgents: 8,
  avgResponse: '12m',
  casesToday: 24,
}

const mockAgents = [
  { 
    id: '1', 
    name: 'Sarah Jenkins', 
    role: 'Senior Agent',
    status: 'online',
    avatar: 'https://randomuser.me/api/portraits/women/44.jpg',
    cases: 45, 
    sla: 98, 
    avgTime: '12m',
    level: { name: 'Expert', icon: '⭐', progress: 70, current: 350, max: 500 }
  },
  { 
    id: '2', 
    name: 'Michael Chen', 
    role: 'Technical Lead',
    status: 'offline',
    avatar: 'https://randomuser.me/api/portraits/men/32.jpg',
    cases: 22, 
    sla: 95, 
    avgTime: '15m',
    level: { name: 'Advanced', icon: '🎯', progress: 40, current: 120, max: 300 }
  },
  { 
    id: '3', 
    name: 'Emily Patel', 
    role: 'Support Agent',
    status: 'online',
    avatar: 'https://randomuser.me/api/portraits/women/68.jpg',
    cases: 38, 
    sla: 99, 
    avgTime: '10m',
    level: { name: 'Proficient', icon: '🚀', progress: 80, current: 200, max: 250 }
  },
  { 
    id: '4', 
    name: 'David Lee', 
    role: 'Support Agent',
    status: 'offline',
    avatar: 'https://randomuser.me/api/portraits/men/75.jpg',
    cases: 15, 
    sla: 92, 
    avgTime: '18m',
    level: { name: 'Beginner', icon: '🌱', progress: 50, current: 50, max: 100 }
  },
]

export function TeamPage() {
  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Team</h1>
        <button className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors">
          <Plus className="w-4 h-4" />
          Invite Member
        </button>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard value={mockTeamMetrics.onlineNow} label="Online Now" hasOnline />
        <MetricCard value={mockTeamMetrics.totalAgents} label="Total Agents" />
        <MetricCard value={mockTeamMetrics.avgResponse} label="Avg Response" />
        <MetricCard value={mockTeamMetrics.casesToday} label="Cases Today" />
      </div>

      {/* Agents Grid */}
      <div className="grid grid-cols-2 gap-6">
        {mockAgents.map(agent => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  )
}

function MetricCard({ value, label, hasOnline }: { value: string | number; label: string; hasOnline?: boolean }) {
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <div className="flex items-center gap-2">
        <span className="text-3xl font-bold text-slate-800">{value}</span>
        {hasOnline && <span className="w-2 h-2 bg-green-500 rounded-full" />}
      </div>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
    </div>
  )
}

interface Agent {
  id: string
  name: string
  role: string
  status: 'online' | 'offline'
  avatar: string
  cases: number
  sla: number
  avgTime: string
  level: { name: string; icon: string; progress: number; current: number; max: number }
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <div className={`bg-white rounded-xl p-5 border-2 ${
      agent.status === 'online' ? 'border-green-200' : 'border-slate-200'
    }`}>
      <div className="flex items-start gap-4">
        {/* Avatar */}
        <div className="relative">
          <img 
            src={agent.avatar} 
            alt={agent.name}
            className="w-16 h-16 rounded-full object-cover"
          />
          <span className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white ${
            agent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
          }`} />
        </div>

        {/* Info */}
        <div className="flex-1">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold text-slate-800">{agent.name}</h3>
              <div className="flex items-center gap-2 mt-0.5">
                <span className={`w-2 h-2 rounded-full ${
                  agent.status === 'online' ? 'bg-green-500' : 'bg-slate-300'
                }`} />
                <span className="text-sm text-slate-500 capitalize">{agent.status}</span>
              </div>
            </div>
            <span className="px-3 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
              {agent.role}
            </span>
          </div>

          {/* Stats */}
          <div className="flex gap-6 mt-4">
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.cases}</span>
              <p className="text-xs text-slate-500">cases</p>
            </div>
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.sla}%</span>
              <p className="text-xs text-slate-500">SLA</p>
            </div>
            <div>
              <span className="text-xl font-bold text-slate-800">{agent.avgTime}</span>
              <p className="text-xs text-slate-500">avg</p>
            </div>
          </div>

          {/* Level */}
          <div className="mt-4">
            <div className="flex items-center gap-2">
              <span>{agent.level.icon}</span>
              <span className="text-sm font-medium text-slate-700">{agent.level.name}</span>
            </div>
            <div className="flex items-center gap-2 mt-2">
              <div className="flex-1 h-2 bg-slate-100 rounded-full">
                <div 
                  className="h-2 bg-blue-500 rounded-full"
                  style={{ width: `${agent.level.progress}%` }}
                />
              </div>
              <span className="text-xs text-slate-500">
                Level {Math.floor(agent.level.current / 100) + 1} - {agent.level.current}/{agent.level.max} XP
              </span>
            </div>
          </div>

          {/* Actions */}
          <button className="text-blue-500 text-sm font-medium mt-3 hover:underline">
            View Profile
          </button>
        </div>
      </div>
    </div>
  )
}
