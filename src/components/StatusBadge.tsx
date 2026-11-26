import { AlertTriangle } from 'lucide-react';
import { PulsingDot } from './PulsingDot';

export type NodeStatus = 'healthy' | 'warning' | 'alarming';

const META: Record<NodeStatus, { label: string; text: string }> = {
  healthy: { label: 'Healthy', text: 'text-[#15803D] dark:text-[#42BE65]' },
  warning: { label: 'Warning', text: 'text-[#B45309] dark:text-[#F1C21B]' },
  alarming: { label: 'Alarming', text: 'text-[#B91C1C] dark:text-[#FA4D56]' },
};

interface StatusBadgeProps {
  status: NodeStatus;
  /** Override the default label. */
  label?: string;
  /** Wrap in a bordered pill instead of plain inline text. */
  pill?: boolean;
  className?: string;
}

/** Consistent status indicator: green/red pulsing dot, amber warning triangle. */
export function StatusBadge({ status, label, pill = false, className = '' }: StatusBadgeProps) {
  const meta = META[status];
  const wrap = pill
    ? 'rounded-md border border-slate-200 dark:border-[#525252] bg-slate-50 dark:bg-[#262626] px-2 py-0.5'
    : '';
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[11px] font-medium whitespace-nowrap ${meta.text} ${wrap} ${className}`}
    >
      {status === 'warning' ? (
        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      ) : (
        <PulsingDot variant={status === 'healthy' ? 'green' : 'red'} />
      )}
      {label ?? meta.label}
    </span>
  );
}
