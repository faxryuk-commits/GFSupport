import { useState } from 'react'
import { TrendingUp, TrendingDown, Clock, Star, ChevronDown } from 'lucide-react'

const periods = ['Last 7 days', 'Last 30 days', 'Last 90 days']

const mockMetrics = {
  totalCases: { value: 156, change: 12, positive: true },
  avgResponse: { value: '23m', change: 15, positive: false },
  resolutionRate: { value: 94, isPercent: true },
  satisfaction: { value: 4.8, max: 5 },
}

const mockCasesOverTime = [
  { date: 'Nov 1', value: 20 },
  { date: 'Nov 8', value: 35 },
  { date: 'Nov 15', value: 60 },
  { date: 'Nov 22', value: 80 },
  { date: 'Nov 29', value: 95 },
]

const mockByCategory = [
  { name: 'Orders', value: 45, color: '#3b82f6' },
  { name: 'Technical', value: 30, color: '#1e3a5f' },
  { name: 'Billing', value: 15, color: '#93c5fd' },
  { name: 'Other', value: 10, color: '#e2e8f0' },
]

const mockAgentTimes = [
  { name: 'Sarah K.', time: 15 },
  { name: 'Mike D.', time: 22 },
  { name: 'Emily R.', time: 18 },
  { name: 'David L.', time: 28 },
  { name: 'Jessica T.', time: 20 },
]

const mockTopIssues = [
  { issue: 'Login Issue', count: 42, trend: '+5%', trendUp: true },
  { issue: 'Payment Failure', count: 35, trend: '-2%', trendUp: false },
  { issue: 'Order Tracking', count: 28, trend: 'Stable', trendUp: null },
  { issue: 'Product Defect', count: 15, trend: '+8%', trendUp: true },
  { issue: 'Account Access', count: 10, trend: 'New', trendUp: null },
]

export function AnalyticsPage() {
  const [period, setPeriod] = useState(periods[1])
  const [showPeriodDropdown, setShowPeriodDropdown] = useState(false)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-slate-800">Analytics</h1>
        <div className="relative">
          <button
            onClick={() => setShowPeriodDropdown(!showPeriodDropdown)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
          >
            Period: {period}
            <ChevronDown className="w-4 h-4" />
          </button>
          {showPeriodDropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-slate-200 py-1 z-10">
              {periods.map(p => (
                <button
                  key={p}
                  onClick={() => { setPeriod(p); setShowPeriodDropdown(false) }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-slate-50 ${
                    period === p ? 'bg-blue-50 text-blue-600' : 'text-slate-700'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-4">
        <MetricCard 
          label="Total Cases" 
          value={mockMetrics.totalCases.value.toString()} 
          change={`${mockMetrics.totalCases.change}%`}
          positive={mockMetrics.totalCases.positive}
        />
        <MetricCard 
          label="Avg Response" 
          value={mockMetrics.avgResponse.value} 
          change={`${mockMetrics.avgResponse.change}%`}
          positive={!mockMetrics.avgResponse.positive}
        />
        <MetricCard 
          label="Resolution Rate" 
          value={`${mockMetrics.resolutionRate.value}%`}
          isCircle
        />
        <MetricCard 
          label="Customer Satisfaction" 
          value={`${mockMetrics.satisfaction.value}/${mockMetrics.satisfaction.max}`}
          isStars
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-2 gap-6">
        {/* Cases Over Time */}
        <div className="bg-white rounded-xl p-6 border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-4">Cases over time</h3>
          <div className="h-48 flex items-end gap-2">
            {mockCasesOverTime.map((item, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-2">
                <div 
                  className="w-full bg-blue-500 rounded-t"
                  style={{ height: `${item.value}%` }}
                />
                <span className="text-xs text-slate-500">{item.date}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Cases by Category */}
        <div className="bg-white rounded-xl p-6 border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-4">Cases by Category</h3>
          <div className="flex items-center gap-8">
            {/* Pie Chart Placeholder */}
            <div className="w-32 h-32 rounded-full bg-gradient-to-br from-blue-500 via-blue-300 to-slate-200 relative">
              <div className="absolute inset-4 bg-white rounded-full" />
            </div>
            {/* Legend */}
            <div className="space-y-2">
              {mockByCategory.map(item => (
                <div key={item.name} className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }} />
                  <span className="text-sm text-slate-600">{item.name}</span>
                  <span className="text-sm font-medium text-slate-800 ml-auto">{item.value}%</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-2 gap-6">
        {/* Response Time by Agent */}
        <div className="bg-white rounded-xl p-6 border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-4">Response time by agent</h3>
          <div className="space-y-3">
            {mockAgentTimes.map(agent => (
              <div key={agent.name} className="flex items-center gap-3">
                <span className="w-20 text-sm text-slate-600">{agent.name}</span>
                <div className="flex-1 bg-slate-100 rounded-full h-2">
                  <div 
                    className="bg-blue-500 h-2 rounded-full"
                    style={{ width: `${(agent.time / 40) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-slate-800 w-12">{agent.time}m</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top Issues */}
        <div className="bg-white rounded-xl p-6 border border-slate-200">
          <h3 className="font-semibold text-slate-800 mb-4">Top Issues</h3>
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-slate-500">
                <th className="pb-3 font-medium">Issue</th>
                <th className="pb-3 font-medium">Count</th>
                <th className="pb-3 font-medium">Trend</th>
              </tr>
            </thead>
            <tbody>
              {mockTopIssues.map(issue => (
                <tr key={issue.issue} className="border-t border-slate-100">
                  <td className="py-3 text-sm text-slate-800">{issue.issue}</td>
                  <td className="py-3 text-sm font-medium text-slate-800">{issue.count}</td>
                  <td className="py-3">
                    <span className={`flex items-center gap-1 text-sm ${
                      issue.trendUp === true ? 'text-red-500' :
                      issue.trendUp === false ? 'text-green-500' :
                      'text-slate-500'
                    }`}>
                      {issue.trendUp === true && <TrendingUp className="w-3.5 h-3.5" />}
                      {issue.trendUp === false && <TrendingDown className="w-3.5 h-3.5" />}
                      {issue.trend}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

interface MetricCardProps {
  label: string
  value: string
  change?: string
  positive?: boolean
  isCircle?: boolean
  isStars?: boolean
}

function MetricCard({ label, value, change, positive, isCircle, isStars }: MetricCardProps) {
  return (
    <div className="bg-white rounded-xl p-5 border border-slate-200">
      <p className="text-sm text-slate-500 mb-2">{label}</p>
      <div className="flex items-center gap-3">
        {isCircle ? (
          <div className="relative w-16 h-16">
            <svg className="w-16 h-16 transform -rotate-90">
              <circle cx="32" cy="32" r="28" stroke="#e2e8f0" strokeWidth="4" fill="none" />
              <circle cx="32" cy="32" r="28" stroke="#3b82f6" strokeWidth="4" fill="none" 
                strokeDasharray={`${parseFloat(value) * 1.76} 176`} />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xl font-bold text-slate-800">
              {value}
            </span>
          </div>
        ) : isStars ? (
          <div className="flex flex-col">
            <span className="text-3xl font-bold text-slate-800">{value}</span>
            <div className="flex gap-0.5 mt-1">
              {[1, 2, 3, 4, 5].map(i => (
                <Star key={i} className={`w-4 h-4 ${i <= 4 ? 'text-yellow-400 fill-yellow-400' : 'text-slate-200'}`} />
              ))}
            </div>
          </div>
        ) : (
          <div>
            <span className="text-3xl font-bold text-slate-800">{value}</span>
            {change && (
              <span className={`flex items-center gap-1 text-sm mt-1 ${positive ? 'text-green-500' : 'text-red-500'}`}>
                {positive ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {change}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
