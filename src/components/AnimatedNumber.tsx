import { animate, useMotionValue, useMotionValueEvent, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

interface AnimatedNumberProps {
  value: number;
  decimals?: number;
  prefix?: string;
  suffix?: string;
  /** Show thousands separators. */
  grouping?: boolean;
  /** Animation length in seconds. */
  duration?: number;
  className?: string;
}

function format(n: number, decimals: number, grouping: boolean): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: grouping,
  });
}

/** Counts from 0 on mount and eases to each new value (~900ms). */
export function AnimatedNumber({
  value,
  decimals = 0,
  prefix = '',
  suffix = '',
  grouping = false,
  duration = 0.9,
  className = '',
}: AnimatedNumberProps) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? value : 0);
  const [display, setDisplay] = useState(() => (reduce ? value : 0));

  useMotionValueEvent(mv, 'change', (v) => setDisplay(v));

  useEffect(() => {
    if (reduce) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: 'easeOut' });
    return () => controls.stop();
  }, [value, duration, reduce, mv]);

  return (
    <span className={`tabular-nums ${className}`}>
      {prefix}
      {format(display, decimals, grouping)}
      {suffix}
    </span>
  );
}

/** Animates the leading number of a formatted string such as "88 MW", "2.4%" or "+12°C". */
export function AnimatedText({ text, className = '' }: { text: string; className?: string }) {
  const match = /^([+-]?\d+(?:\.(\d+))?)(.*)$/.exec(text);
  if (!match) return <span className={className}>{text}</span>;
  return (
    <AnimatedNumber
      value={parseFloat(match[1])}
      decimals={match[2]?.length ?? 0}
      prefix={match[1].startsWith('+') ? '+' : ''}
      suffix={match[3]}
      className={className}
    />
  );
}
