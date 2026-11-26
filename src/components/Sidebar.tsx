import {
  Cpu,
  FlaskConical,
  LayoutDashboard,
  Moon,
  Radar,
  Sun,
  TrendingUp,
  X,
} from 'lucide-react';
import type { BackendRuntimeStatus, GridSummary, NavTab, QiskitBackend } from '../types/grid';
import { QISKIT_BACKENDS } from '../constants';
import { BrandLogo } from './BrandLogo';
import { PulsingDot } from './PulsingDot';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  summary: GridSummary;
  activeBackend: QiskitBackend;
  onBackendChange: (backend: QiskitBackend) => void;
  backendStatus: BackendRuntimeStatus;
  isDark: boolean;
  onToggleTheme: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const NAV_ITEMS: { id: NavTab; label: string; subtitle: string; icon: typeof LayoutDashboard }[] = [
  {
    id: 'overview',
    label: 'Overview',
    subtitle: 'Live grid & alerts',
    icon: LayoutDashboard,
  },
  {
    id: 'diagnostics',
    label: 'Node Diagnostics',
    subtitle: 'Per-node telemetry',
    icon: Radar,
  },
  {
    id: 'kernels',
    label: 'Quantum Kernels & QA',
    subtitle: 'Circuits & benchmarks',
    icon: Cpu,
  },
  {
    id: 'explore',
    label: 'Explore & Qiskit Lab',
    subtitle: 'Upload & test datasets',
    icon: FlaskConical,
  },
  {
    id: 'impact',
    label: 'Impact & Constraints',
    subtitle: 'Accuracy over time',
    icon: TrendingUp,
  },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  summary,
  activeBackend,
  onBackendChange,
  backendStatus,
  isDark,
  onToggleTheme,
  mobileOpen,
  onCloseMobile,
}: SidebarProps) {
  const statusMeta =
    backendStatus.mode === 'working'
      ? {
          label: 'Working on Job',
          detail: backendStatus.activeJob?.algorithm ?? 'IBM Simulator',
          colorClass: 'text-[#0F62FE] dark:text-[#78A9FF]',
          glyph: '◆',
        }
      : backendStatus.mode === 'ibm_quantum_live'
      ? {
          label: 'IBM Quantum Live',
          detail: 'Hardware token active',
          colorClass: 'text-[#15803D] dark:text-[#42BE65]',
          glyph: '●',
        }
      : backendStatus.mode === 'ibm_simulator'
      ? {
          label: 'IBM Simulator',
          detail: 'Backend API connected',
          colorClass: 'text-[#15803D] dark:text-[#42BE65]',
          glyph: '●',
        }
      : {
          label: 'Offline Mode',
          detail: 'Local browser engine',
          colorClass: 'text-[#B45309] dark:text-[#F1C21B]',
          glyph: '▲',
        };
  const sidebarBody = (
    <div className="flex h-full flex-col bg-white dark:bg-[#161616] border-r border-slate-200 dark:border-[#393939]">
      <div className="flex items-center justify-between px-5 h-16 border-b border-slate-200 dark:border-[#393939] shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 dark:border-[#393939] bg-white dark:bg-[#262626] shrink-0">
            <BrandLogo className="h-7 w-7" />
          </div>
          <span className="text-[15px] font-bold tracking-tight text-slate-900 dark:text-[#F4F4F4] whitespace-nowrap">
            Digital Q-Grid Twin
          </span>
        </div>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close navigation menu"
          className="lg:hidden rounded-md p-2 text-slate-500 hover:bg-slate-100 dark:text-[#C6C6C6] dark:hover:bg-[#353535] hover:text-slate-900 dark:hover:text-[#F4F4F4]"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <nav aria-label="Primary navigation" className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                onSelectTab(item.id);
                onCloseMobile();
              }}
              aria-current={isActive ? 'page' : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors focus-visible:outline-2 focus-visible:outline-[#0F62FE] ${
                isActive
                  ? 'bg-[#0F62FE]/10 dark:bg-[#353535] text-[#0F62FE] dark:text-[#F4F4F4] font-semibold'
                  : 'text-slate-700 dark:text-[#C6C6C6] hover:bg-slate-100 dark:hover:bg-[#262626] hover:text-slate-900 dark:hover:text-[#F4F4F4] font-medium'
              }`}
            >
              <Icon
                className={`h-4 w-4 shrink-0 ${
                  isActive ? 'text-[#0F62FE] dark:text-[#78A9FF]' : 'text-slate-400 dark:text-[#8D8D8D]'
                }`}
                aria-hidden="true"
              />
              <div className="min-w-0">
                <div className="text-sm leading-tight whitespace-nowrap truncate">{item.label}</div>
                <div className="text-[11px] font-normal text-slate-500 dark:text-[#A8A8A8] truncate mt-0.5">
                  {item.subtitle}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 dark:border-[#393939] px-4 py-4 space-y-4 bg-slate-50/70 dark:bg-[#1E1E1E]">
        <div>
          <label
            htmlFor="sidebar-backend-select"
            className="block text-xs font-medium text-slate-600 dark:text-[#C6C6C6] mb-1.5"
          >
            IBM Qiskit Backend
          </label>
          <select
            id="sidebar-backend-select"
            value={activeBackend}
            onChange={(e) => onBackendChange(e.target.value as QiskitBackend)}
            className="w-full rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#262626] pl-2 pr-1 py-2 text-[11px] font-mono text-slate-800 dark:text-[#F4F4F4] focus:border-[#0F62FE] focus:outline-none"
          >
            {QISKIT_BACKENDS.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>

        <div className="border-t border-slate-200 dark:border-[#393939] pt-3">
          <div className="flex items-center justify-between text-xs text-slate-600 dark:text-[#C6C6C6] mb-2">
            <span>Grid Health Split</span>
            <span className="font-mono font-semibold text-slate-900 dark:text-[#F4F4F4] tabular-nums">
              {summary.healthIndex}%
            </span>
          </div>
          <div className="flex h-2 w-full overflow-hidden rounded-sm bg-slate-200 dark:bg-[#393939]">
            <div
              className="bg-[#16A34A] transition-all duration-300"
              style={{ width: `${(summary.healthyCount / Math.max(1, summary.totalNodes)) * 100}%` }}
            />
            <div
              className="bg-[#D97706] transition-all duration-300"
              style={{ width: `${(summary.warningCount / Math.max(1, summary.totalNodes)) * 100}%` }}
            />
            <div
              className="bg-[#DC2626] transition-all duration-300"
              style={{ width: `${(summary.alarmingCount / Math.max(1, summary.totalNodes)) * 100}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-600 dark:text-[#A8A8A8]">
            <span className="text-[#15803D] dark:text-[#42BE65]">● {summary.healthyCount} Healthy</span>
            <span className="text-[#B45309] dark:text-[#F1C21B]">▲ {summary.warningCount} Warn</span>
            <span className="text-[#B91C1C] dark:text-[#FA4D56]">■ {summary.alarmingCount} Alarm</span>
          </div>
        </div>

        {/* Backend / IBM Simulator Runtime Status */}
        <div className="border-t border-slate-200 dark:border-[#393939] pt-3">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-600 dark:text-[#A8A8A8]">Solver Engine</span>
            <span
              data-testid="sidebar-engine-status"
              className={`inline-flex items-center gap-1 font-mono text-[11px] font-semibold ${statusMeta.colorClass}`}
            >
              {backendStatus.mode === 'ibm_quantum_live' ? (
                <PulsingDot variant="green" />
              ) : (
                <span aria-hidden="true">{statusMeta.glyph}</span>
              )}
              {statusMeta.label}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 dark:text-[#8D8D8D] truncate">
            {statusMeta.detail}
            {backendStatus.liveRunsCount > 0 ? ` · ${backendStatus.liveRunsCount} live runs` : ''}
          </div>
        </div>

        {/* Light / Dark Theme Switch */}
        <div className="border-t border-slate-200 dark:border-[#393939] pt-3">
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
            className="w-full inline-flex items-center justify-between rounded-md border border-slate-300 dark:border-[#525252] bg-white dark:bg-[#262626] px-3 py-2 text-xs font-medium text-slate-700 dark:text-[#F4F4F4] hover:bg-slate-100 dark:hover:bg-[#353535] transition-colors"
          >
            <span className="inline-flex items-center gap-2">
              {isDark ? (
                <Sun className="h-3.5 w-3.5 text-[#F1C21B]" aria-hidden="true" />
              ) : (
                <Moon className="h-3.5 w-3.5 text-slate-600" aria-hidden="true" />
              )}
              <span>{isDark ? 'Light Theme' : 'Carbon Dark'}</span>
            </span>
            <span className="font-mono text-[11px] text-slate-500 dark:text-[#A8A8A8]">
              {isDark ? 'Gray 100' : 'Light'}
            </span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block w-64 shrink-0 h-screen sticky top-0">{sidebarBody}</aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div
            className="fixed inset-0 bg-black/70"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative z-10 w-64 max-w-[82vw] h-full">{sidebarBody}</aside>
        </div>
      )}
    </>
  );
}
