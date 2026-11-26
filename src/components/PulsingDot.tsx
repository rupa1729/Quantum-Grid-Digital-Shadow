export type PulsingDotVariant = 'green' | 'red' | 'amber';

const VARIANT_CLASSES: Record<PulsingDotVariant, string> = {
  green: 'bg-[#24A148] dark:bg-[#42BE65]',
  red: 'bg-[#DA1E28] dark:bg-[#FA4D56]',
  amber: 'bg-[#F1C21B]',
};

interface PulsingDotProps {
  variant?: PulsingDotVariant;
  /** Tailwind size classes, default h-2 w-2. */
  size?: string;
  className?: string;
}

/** Radar-ripple status dot: solid core with an expanding ring. */
export function PulsingDot({ variant = 'green', size = 'h-2 w-2', className = '' }: PulsingDotProps) {
  const color = VARIANT_CLASSES[variant];
  return (
    <span className={`relative inline-flex shrink-0 ${size} ${className}`} aria-hidden="true">
      <span
        className={`absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping motion-reduce:animate-none ${color}`}
      />
      <span className={`relative inline-flex h-full w-full rounded-full ${color}`} />
    </span>
  );
}
