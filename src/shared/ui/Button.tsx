import { forwardRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'primary', size = 'md', loading, children, disabled, ...props }, ref) => {
    const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all'

    const variants = {
      primary: 'bg-gradient-to-br from-[#3b82f6] to-[#2563eb] text-white shadow-[0_4px_14px_rgba(37,99,235,0.25)] hover:shadow-[0_6px_18px_rgba(37,99,235,0.38)] hover:brightness-[1.04]',
      secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
      danger: 'bg-red-500 text-white hover:bg-red-600',
      ghost: 'bg-transparent text-slate-600 hover:bg-slate-100'
    }
    
    const sizes = {
      sm: 'px-3 py-1.5 text-sm',
      md: 'px-4 py-2 text-sm',
      lg: 'px-6 py-3 text-base'
    }

    return (
      <button
        ref={ref}
        className={`${baseStyles} ${variants[variant]} ${sizes[size]} ${className}`}
        disabled={disabled || loading}
        {...props}
      >
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
