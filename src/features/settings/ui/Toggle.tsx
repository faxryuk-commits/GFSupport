interface ToggleProps {
  label: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
}

export function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <div className="flex items-center justify-between py-3 px-1 rounded-lg hover:bg-white/50 transition-colors">
      <div className="flex-1 min-w-0 mr-4">
        <label className="text-sm font-medium text-slate-700 cursor-pointer" onClick={() => onChange(!checked)}>
          {label}
        </label>
        {description && <p className="text-xs text-slate-500 mt-0.5">{description}</p>}
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={`relative w-12 h-7 rounded-full transition-all flex-shrink-0 ${
          checked 
            ? 'bg-gradient-to-r from-blue-500 to-blue-600 shadow-lg shadow-blue-500/25' 
            : 'bg-slate-200 hover:bg-slate-300'
        }`}
      >
        <span className={`absolute top-1 w-5 h-5 bg-white rounded-full shadow-md transition-all ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`} />
      </button>
    </div>
  )
}
