import { useId } from 'react';

interface InfoTooltipProps {
  text: string;
  label?: string;
}

/** Small "?" badge showing a plain-English hint on hover or keyboard focus. */
export function InfoTooltip({ text, label = 'More info' }: InfoTooltipProps) {
  const id = useId();
  return (
    <span className="relative inline-flex align-middle group">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border border-slate-300 dark:border-[#525252] text-[9px] font-semibold leading-none text-slate-500 dark:text-[#A8A8A8] hover:border-[#0F62FE] hover:text-[#0F62FE] dark:hover:text-[#78A9FF] focus-visible:outline-2 focus-visible:outline-[#0F62FE]"
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-1/2 top-full z-30 mt-1.5 w-56 -translate-x-1/2 rounded-md border border-slate-200 dark:border-[#525252] bg-white dark:bg-[#262626] px-2.5 py-2 text-[11px] font-normal leading-snug text-slate-700 dark:text-[#E0E0E0] shadow-md opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}
