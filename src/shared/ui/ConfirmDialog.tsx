import { Modal } from './Modal'
import { AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react'

interface ConfirmDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'info' | 'success'
  isLoading?: boolean
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  isLoading = false,
}: ConfirmDialogProps) {
  const variants = {
    danger: { 
      icon: XCircle, 
      iconColor: 'text-red-500', 
      iconBg: 'bg-red-100',
      button: 'bg-red-500 hover:bg-red-600' 
    },
    warning: { 
      icon: AlertTriangle, 
      iconColor: 'text-amber-500', 
      iconBg: 'bg-amber-100',
      button: 'bg-amber-500 hover:bg-amber-600' 
    },
    info: { 
      icon: Info, 
      iconColor: 'text-blue-500', 
      iconBg: 'bg-blue-100',
      button: 'bg-blue-500 hover:bg-blue-600' 
    },
    success: { 
      icon: CheckCircle, 
      iconColor: 'text-green-500', 
      iconBg: 'bg-green-100',
      button: 'bg-green-500 hover:bg-green-600' 
    },
  }

  const config = variants[variant]
  const Icon = config.icon

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="sm">
      <div className="text-center">
        <div className={`mx-auto w-12 h-12 ${config.iconBg} rounded-full flex items-center justify-center mb-4`}>
          <Icon className={`w-6 h-6 ${config.iconColor}`} />
        </div>
        <h3 className="text-lg font-semibold text-slate-800 mb-2">{title}</h3>
        <p className="text-slate-500 mb-6">{message}</p>
        <div className="flex gap-3 justify-center">
          <button
            onClick={onClose}
            disabled={isLoading}
            className="px-6 py-2.5 bg-slate-100 text-slate-700 font-medium rounded-lg hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            disabled={isLoading}
            className={`px-6 py-2.5 text-white font-medium rounded-lg transition-colors disabled:opacity-50 ${config.button}`}
          >
            {isLoading ? 'Loading...' : confirmText}
          </button>
        </div>
      </div>
    </Modal>
  )
}
