interface LogoProps {
  height?: number
  className?: string
}

export function Logo({ height = 32, className = '' }: LogoProps) {
  return (
    <svg 
      height={height} 
      viewBox="0 0 120 32" 
      fill="none" 
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* GF Text */}
      <text 
        x="0" 
        y="24" 
        fontFamily="system-ui, -apple-system, sans-serif" 
        fontSize="24" 
        fontWeight="700" 
        fill="currentColor"
      >
        GF
      </text>
      {/* Support text */}
      <text 
        x="42" 
        y="24" 
        fontFamily="system-ui, -apple-system, sans-serif" 
        fontSize="24" 
        fontWeight="500" 
        fill="#64748b"
      >
        Support
      </text>
    </svg>
  )
}

export default Logo
