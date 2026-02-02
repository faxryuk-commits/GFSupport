import { ReactNode } from 'react'

interface Tab {
  id: string
  label: string
  icon?: ReactNode
  badge?: number
  disabled?: boolean
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onChange: (tabId: string) => void
  variant?: 'default' | 'pills' | 'underline'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export function Tabs({ tabs, activeTab, onChange, variant = 'default', size = 'md', className = '' }: TabsProps) {
  const sizeClasses = {
    sm: 'text-xs px-3 py-1.5',
    md: 'text-sm px-4 py-2',
    lg: 'text-base px-5 py-2.5',
  }

  const variantClasses = {
    default: {
      container: 'bg-slate-100 p-1 rounded-lg',
      tab: 'rounded-md',
      active: 'bg-white shadow-sm text-slate-800',
      inactive: 'text-slate-600 hover:text-slate-800',
    },
    pills: {
      container: 'gap-2',
      tab: 'rounded-full',
      active: 'bg-blue-500 text-white',
      inactive: 'bg-slate-100 text-slate-600 hover:bg-slate-200',
    },
    underline: {
      container: 'border-b border-slate-200',
      tab: 'border-b-2 -mb-px rounded-none',
      active: 'border-blue-500 text-blue-600',
      inactive: 'border-transparent text-slate-600 hover:text-slate-800 hover:border-slate-300',
    },
  }

  const styles = variantClasses[variant]

  return (
    <div className={`flex ${styles.container} ${className}`}>
      {tabs.map(tab => (
        <button
          key={tab.id}
          onClick={() => !tab.disabled && onChange(tab.id)}
          disabled={tab.disabled}
          className={`flex items-center gap-2 font-medium transition-all ${sizeClasses[size]} ${styles.tab} ${
            activeTab === tab.id ? styles.active : styles.inactive
          } ${tab.disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          {tab.icon}
          {tab.label}
          {tab.badge !== undefined && tab.badge > 0 && (
            <span className={`min-w-[18px] h-[18px] px-1 flex items-center justify-center text-xs font-semibold rounded-full ${
              activeTab === tab.id 
                ? variant === 'pills' ? 'bg-white/20 text-white' : 'bg-blue-100 text-blue-600'
                : 'bg-slate-200 text-slate-600'
            }`}>
              {tab.badge}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

interface TabPanelProps {
  children: ReactNode
  tabId: string
  activeTab: string
}

export function TabPanel({ children, tabId, activeTab }: TabPanelProps) {
  if (tabId !== activeTab) return null
  return <div>{children}</div>
}
