interface PearLogoProps {
  className?: string;
  size?: number;
}

export function PearLogo({ className = "w-10 h-10", size }: PearLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      width={size}
      height={size}
      aria-hidden="true"
    >
      {/* Subtle icy ambient glow ring */}
      <circle cx="50" cy="58" r="34" fill="#7dd3fc" fillOpacity="0.12" />
      {/* Minimalist stylized pear silhouette in Glacier Ice Blue */}
      <path
        d="M50 18 C42 30 31 43 31 60 C31 73 39.5 83 50 83 C60.5 83 69 73 69 60 C69 43 58 30 50 18 Z"
        fill="#7dd3fc"
      />
      {/* Inner P2P direct peer core (negative space / dark surface contrast) */}
      <circle cx="50" cy="58" r="6.5" fill="#080c14" />
      {/* Minimal stem accent */}
      <path d="M50 18 C50.5 12 55 8 61 7" stroke="#38bdf8" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export default PearLogo;
