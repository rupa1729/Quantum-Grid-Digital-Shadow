import { AlertTriangle } from 'lucide-react';
import type { HealthStatus } from '../types/grid';
import { PulsingDot } from './PulsingDot';

interface StatusIndicatorProps {
  status: HealthStatus | 'pass' | 'fail' | 'resolved';
  compact?: boolean;
  badgeStyle?: boolean;
}

const CONFIG = {
  healthy: {
    label: 'Healthy',
    glyph: '●',
    textClass: 'text-[#15803D] dark:text-[#42BE65]',
    badgeClass:
      'bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0] dark:bg-[#16291D] dark:text-[#42BE65] dark:border-[#245937]',
  },
  warning: {
    label: 'Warning',
    glyph: '▲',
    textClass: 'text-[#B45309] dark:text-[#F1C21B]',
    badgeClass:
      'bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] dark:bg-[#2B240D] dark:text-[#F1C21B] dark:border-[#6E560F]',
  },
  alarming: {
    label: 'Alarming',
    glyph: '■',
    textClass: 'text-[#B91C1C] dark:text-[#FA4D56]',
    badgeClass:
      'bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] dark:bg-[#311315] dark:text-[#FA4D56] dark:border-[#751F24]',
  },
  pass: {
    label: 'Pass',
    glyph: '●',
    textClass: 'text-[#15803D] dark:text-[#42BE65]',
    badgeClass:
      'bg-[#DCFCE7] text-[#166534] border border-[#BBF7D0] dark:bg-[#16291D] dark:text-[#42BE65] dark:border-[#245937]',
  },
  fail: {
    label: 'Fail',
    glyph: '■',
    textClass: 'text-[#B91C1C] dark:text-[#FA4D56]',
    badgeClass:
      'bg-[#FEE2E2] text-[#991B1B] border border-[#FECACA] dark:bg-[#311315] dark:text-[#FA4D56] dark:border-[#751F24]',
  },
  resolved: {
    label: 'Resolved',
    glyph: '●',
    textClass: 'text-[#0F62FE] dark:text-[#78A9FF]',
    badgeClass:
      'bg-[#DBEAFE] text-[#1E40AF] border border-[#BFDBFE] dark:bg-[#262626] dark:text-[#78A9FF] dark:border-[#525252]',
  },
} as const;

function StatusMark({ status, glyph }: { status: StatusIndicatorProps['status']; glyph: string }) {
  if (status === 'healthy') return <PulsingDot variant="green" />;
  if (status === 'alarming') return <PulsingDot variant="red" />;
  if (status === 'warning') return <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />;
  return (
    <span aria-hidden="true" className="text-[9px] leading-none">
      {glyph}
    </span>
  );
}

export function StatusIndicator({ status, compact = false, badgeStyle = false }: StatusIndicatorProps) {
  const cfg = CONFIG[status];
  if (badgeStyle) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${cfg.badgeClass}`}
      >
        <StatusMark status={status} glyph={cfg.glyph} />
        <span>{cfg.label}</span>
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 font-medium whitespace-nowrap ${
        compact ? 'text-xs' : 'text-[13px]'
      } ${cfg.textClass}`}
    >
      <StatusMark status={status} glyph={cfg.glyph} />
      <span>{cfg.label}</span>
    </span>
  );
}
