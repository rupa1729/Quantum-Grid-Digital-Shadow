interface BrandLogoProps {
  className?: string;
}

/** Quantum orbital ring + energy bolt. Mirrors public/favicon.svg. */
export function BrandLogo({ className = 'h-7 w-7' }: BrandLogoProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true" focusable="false">
      <ellipse cx="16" cy="16" rx="13" ry="6" transform="rotate(-30 16 16)" stroke="#0f62fe" strokeWidth="2.4" />
      <circle cx="27.3" cy="9.5" r="2.6" fill="#0f62fe" />
      <circle cx="4.7" cy="22.5" r="2.6" fill="#0f62fe" />
      <path d="M18.5 5 9.5 18H15l-1.5 9 9-13H17z" fill="#00bab6" />
    </svg>
  );
}
