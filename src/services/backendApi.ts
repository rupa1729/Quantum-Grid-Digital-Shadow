import type {
  BackendRuntimeStatus,
  ClassicalAlgorithm,
  ClassicalOptimizer,
  ClimateConditions,
  ConstraintId,
  ExploreRunResult,
  GridAlert,
  GridTopology,
  HardwareCapabilities,
  LiveRegionStreamPayload,
  QiskitBackend,
  QiskitJobExecutionResult,
  QiskitRuntimeCapabilities,
  QuboSuiteResult,
  QuantumAlgorithm,
} from '../types/grid';
import { OFFLINE_BACKEND_STATUS } from '../constants';
import {
  runExploreComparison,
  runQuantumGridOptimization,
} from '../engine/quantumGridEngine';
import { runAllSolversSuite } from '../engine/quboSolverEngine';
import {
  buildFallbackStreamPayload,
  buildOpenMeteoUrl,
  getLiveRegionById,
  parseOpenMeteoResponse,
} from '../data/liveRegions';

export async function fetchBackendStatus(): Promise<BackendRuntimeStatus> {
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    const res = await fetch('/api/status', { signal: controller.signal });
    window.clearTimeout(timer);
    if (!res.ok) return OFFLINE_BACKEND_STATUS;
    return (await res.json()) as BackendRuntimeStatus;
  } catch {
    return OFFLINE_BACKEND_STATUS;
  }
}

export async function fetchLiveRuns(): Promise<ExploreRunResult[]> {
  try {
    const res = await fetch('/api/live-runs');
    if (!res.ok) return [];
    const data = (await res.json()) as { runs?: ExploreRunResult[] };
    return Array.isArray(data.runs) ? data.runs : [];
  } catch {
    return [];
  }
}

export async function executeGridOptimizationJob(params: {
  topology: GridTopology;
  backend: QiskitBackend;
  seed: number;
}): Promise<{
  topology: GridTopology;
  lossReductionPct: number;
  resolvedAlerts: GridAlert[];
  status: BackendRuntimeStatus;
  source: 'live_backend' | 'offline_local';
}> {
  try {
    const res = await fetch('/api/optimize-grid', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      topology: GridTopology;
      lossReductionPct: number;
      resolvedAlerts: GridAlert[];
      status: BackendRuntimeStatus;
    };
    return { ...data, source: 'live_backend' };
  } catch {
    const local = runQuantumGridOptimization(params.topology, params.seed);
    return {
      ...local,
      status: OFFLINE_BACKEND_STATUS,
      source: 'offline_local',
    };
  }
}

export async function executeBenchmarkJob(params: {
  topology: GridTopology;
  quantumAlgorithm: QuantumAlgorithm;
  classicalAlgorithm: ClassicalAlgorithm;
  backend: QiskitBackend;
  shots: number;
  constraints: ConstraintId[];
  climate: ClimateConditions;
  partitionQubits: number;
}): Promise<{
  result: ExploreRunResult;
  status: BackendRuntimeStatus;
  usedCustomTemplate: boolean;
}> {
  try {
    const res = await fetch('/api/optimize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      result: ExploreRunResult;
      status: BackendRuntimeStatus;
      usedCustomTemplate: boolean;
    };
    return data;
  } catch {
    const localResult = runExploreComparison(params);
    return {
      result: { ...localResult, executionSource: 'offline_local' },
      status: OFFLINE_BACKEND_STATUS,
      usedCustomTemplate: false,
    };
  }
}

export async function fetchLiveRegionStream(
  regionId: string,
  forceRefresh: boolean
): Promise<LiveRegionStreamPayload | null> {
  const region = getLiveRegionById(regionId);
  if (!region) return null;

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    const qs = new URLSearchParams({ regionId });
    if (forceRefresh) qs.set('refresh', '1');
    const res = await fetch(`/api/live-grid/stream?${qs.toString()}`, {
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (res.ok) {
      const data = (await res.json()) as LiveRegionStreamPayload;
      if (data && Array.isArray(data.nodeSeries) && data.nodeSeries.length > 0) {
        return data;
      }
    }
  } catch {
    // Fall through to direct public Open-Meteo CORS request
  }

  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 7000);
    const res = await fetch(buildOpenMeteoUrl(region), { signal: controller.signal });
    window.clearTimeout(timer);
    if (res.ok) {
      const rawJson: unknown = await res.json();
      const parsed = parseOpenMeteoResponse(rawJson, region);
      if (parsed) return parsed;
    }
  } catch {
    // Fall through to deterministic diurnal model
  }

  return buildFallbackStreamPayload(region);
}

export async function executeQuboSolverSuite(params: {
  topology: GridTopology;
  climate: ClimateConditions;
  constraints: ConstraintId[];
  backend: QiskitBackend;
  hardware: HardwareCapabilities;
  layersP: number;
  optimizer: ClassicalOptimizer;
  shots: number;
  selectedAlgorithm: QuantumAlgorithm;
}): Promise<{
  suite: QuboSuiteResult;
  status: BackendRuntimeStatus;
  source: 'ibm_simulator_api' | 'local_engine';
}> {
  try {
    const res = await fetch('/api/qubo-suite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      suite: QuboSuiteResult;
      status: BackendRuntimeStatus;
    };
    return { suite: data.suite, status: data.status, source: 'ibm_simulator_api' };
  } catch {
    const suite = runAllSolversSuite(params);
    return { suite, status: OFFLINE_BACKEND_STATUS, source: 'local_engine' };
  }
}

export async function fetchQiskitCapabilities(): Promise<QiskitRuntimeCapabilities | null> {
  try {
    const res = await fetch('/api/qiskit/status');
    if (!res.ok) return null;
    return (await res.json()) as QiskitRuntimeCapabilities;
  } catch {
    return null;
  }
}

export async function submitRealQiskitJob(params: {
  topology: GridTopology;
  climate: ClimateConditions;
  constraints: ConstraintId[];
  backend: QiskitBackend;
  targetBackendName?: string;
  algorithm: QuantumAlgorithm;
  optimizer: ClassicalOptimizer;
  layersP: number;
  shots: number;
}): Promise<
  | { ok: true; job: QiskitJobExecutionResult; status: BackendRuntimeStatus }
  | { ok: false; error: string; capabilities?: QiskitRuntimeCapabilities }
> {
  try {
    const res = await fetch('/api/qiskit/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as {
      job?: QiskitJobExecutionResult;
      status?: BackendRuntimeStatus;
      error?: string;
      capabilities?: QiskitRuntimeCapabilities;
    };
    if (!res.ok || !data.job) {
      return {
        ok: false,
        error: data.error ?? `Qiskit execution failed (HTTP ${res.status}).`,
        capabilities: data.capabilities,
      };
    }
    return {
      ok: true,
      job: data.job,
      status: data.status ?? OFFLINE_BACKEND_STATUS,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to reach /api/qiskit/execute.',
    };
  }
}

export async function submitBatchRealQiskitJob(params: {
  topology: GridTopology;
  climate: ClimateConditions;
  constraints: ConstraintId[];
  backend: QiskitBackend;
  targetBackendName?: string;
  layersP: number;
  shots: number;
}): Promise<
  | { ok: true; job: QiskitJobExecutionResult; status: BackendRuntimeStatus }
  | { ok: false; error: string; capabilities?: QiskitRuntimeCapabilities }
> {
  try {
    const res = await fetch('/api/qiskit/execute-batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = (await res.json()) as {
      job?: QiskitJobExecutionResult;
      status?: BackendRuntimeStatus;
      error?: string;
      capabilities?: QiskitRuntimeCapabilities;
    };
    if (!res.ok || !data.job) {
      return {
        ok: false,
        error: data.error ?? `Batch IBM QPU execution failed (HTTP ${res.status}).`,
        capabilities: data.capabilities,
      };
    }
    return {
      ok: true,
      job: data.job,
      status: data.status ?? OFFLINE_BACKEND_STATUS,
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Unable to reach /api/qiskit/execute-batch.',
    };
  }
}

export async function pollRealQiskitJob(
  jobId: string
): Promise<{ ok: true; job: QiskitJobExecutionResult } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/qiskit/jobs/${encodeURIComponent(jobId)}`);
    const data = (await res.json()) as { job?: QiskitJobExecutionResult; error?: string };
    if (!res.ok || !data.job) {
      return { ok: false, error: data.error ?? `Failed to poll job (HTTP ${res.status}).` };
    }
    return { ok: true, job: data.job };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Failed to poll IBM Quantum job.' };
  }
}
