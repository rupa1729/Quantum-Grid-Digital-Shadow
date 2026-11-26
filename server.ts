import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import type {
  ClassicalAlgorithm,
  ClassicalOptimizer,
  ClimateConditions,
  ConstraintId,
  CouplingTopology,
  ExploreRunResult,
  GridTopology,
  HardwareCapabilities,
  LiveRegionStreamPayload,
  QiskitBackend,
  QuantumAlgorithm,
} from './src/types/grid.ts';
import {
  ALL_CLASSICAL_ALGORITHMS,
  ALL_QUANTUM_ALGORITHMS,
  BACKEND_RESPONSE_SCHEMA,
  CLASSICAL_OPTIMIZERS,
  CONSTRAINT_IDS,
  COUPLING_TOPOLOGIES,
  IBM_HARDWARE_PROFILES,
  LIVE_REGIONS,
  OPEN_METEO_CONFIG,
  QISKIT_BACKENDS,
} from './src/constants/index.ts';
import {
  runExploreComparison,
  runQuantumGridOptimization,
} from './src/engine/quantumGridEngine.ts';
import { runAllSolversSuite } from './src/engine/quboSolverEngine.ts';
import {
  CUSTOM_ALGORITHM_TEMPLATE,
  runCustomQuantumAlgorithm,
} from './server/algorithmTemplate.ts';
import {
  buildFallbackStreamPayload,
  buildOpenMeteoUrl,
  getLiveRegionById,
  parseOpenMeteoResponse,
} from './src/data/liveRegions.ts';
import {
  executeBatchRealQiskitJob,
  executeRealQiskitJob,
  getQiskitRuntimeCapabilities,
  pollIbmQuantumJob,
} from './server/qiskitExecutor.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_QUANTUM_ALGOS = new Set<QuantumAlgorithm>(ALL_QUANTUM_ALGORITHMS);
const ALLOWED_CLASSICAL_ALGOS = new Set<ClassicalAlgorithm>(ALL_CLASSICAL_ALGORITHMS);
const ALLOWED_BACKENDS = new Set<QiskitBackend>(QISKIT_BACKENDS);
const ALLOWED_OPTIMIZERS = new Set<ClassicalOptimizer>(CLASSICAL_OPTIMIZERS);
const ALLOWED_TOPOLOGIES = new Set<CouplingTopology>(COUPLING_TOPOLOGIES);
const ALLOWED_CONSTRAINTS = new Set<ConstraintId>(CONSTRAINT_IDS);

interface ActiveJobInfo {
  jobId: string;
  algorithm: string;
  backend: QiskitBackend;
  startedAt: string;
  status: 'working' | 'completed';
}

const liveRunsStore: ExploreRunResult[] = [];
let activeJob: ActiveJobInfo | null = null;
const liveStreamCache = new Map<string, { expiresAt: number; payload: LiveRegionStreamPayload }>();

function isValidTopology(raw: unknown): raw is GridTopology {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.name !== 'string' || !Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) {
    return false;
  }
  if (obj.nodes.length < 3 || obj.nodes.length > 200 || obj.edges.length > 1000) {
    return false;
  }
  const nodesValid = obj.nodes.every((n) => {
    if (!n || typeof n !== 'object') return false;
    const node = n as Record<string, unknown>;
    return (
      typeof node.id === 'string' &&
      node.id.length > 0 &&
      typeof node.loadMW === 'number' &&
      Number.isFinite(node.loadMW) &&
      typeof node.capacityMW === 'number' &&
      Number.isFinite(node.capacityMW) &&
      node.capacityMW > 0
    );
  });
  if (!nodesValid) return false;

  return obj.edges.every((e) => {
    if (!e || typeof e !== 'object') return false;
    const edge = e as Record<string, unknown>;
    return (
      typeof edge.source === 'string' &&
      typeof edge.target === 'string' &&
      typeof edge.flowMW === 'number' &&
      Number.isFinite(edge.flowMW) &&
      typeof edge.limitMW === 'number' &&
      Number.isFinite(edge.limitMW) &&
      edge.limitMW > 0
    );
  });
}

function parseClimate(raw: unknown): ClimateConditions | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (
    typeof c.locationName !== 'string' ||
    c.locationName.trim().length === 0 ||
    typeof c.ambientTempC !== 'number' ||
    !Number.isFinite(c.ambientTempC) ||
    typeof c.windSpeedMs !== 'number' ||
    !Number.isFinite(c.windSpeedMs) ||
    typeof c.solarIrradianceWm2 !== 'number' ||
    !Number.isFinite(c.solarIrradianceWm2) ||
    typeof c.stormRiskPct !== 'number' ||
    !Number.isFinite(c.stormRiskPct) ||
    typeof c.peakTariffMultiplier !== 'number' ||
    !Number.isFinite(c.peakTariffMultiplier)
  ) {
    return null;
  }

  return {
    locationName: c.locationName.trim().slice(0, 80),
    ambientTempC: Math.max(-30, Math.min(65, c.ambientTempC)),
    windSpeedMs: Math.max(0, Math.min(50, c.windSpeedMs)),
    solarIrradianceWm2: Math.max(0, Math.min(1400, c.solarIrradianceWm2)),
    stormRiskPct: Math.max(0, Math.min(100, c.stormRiskPct)),
    peakTariffMultiplier: Math.max(0.5, Math.min(3.0, c.peakTariffMultiplier)),
  };
}

function parseHardware(raw: unknown, backend: QiskitBackend): HardwareCapabilities | null {
  if (!raw || typeof raw !== 'object') return null;
  const h = raw as Record<string, unknown>;
  const base = IBM_HARDWARE_PROFILES[backend];
  if (
    typeof h.maxQubits !== 'number' ||
    !Number.isFinite(h.maxQubits) ||
    !ALLOWED_TOPOLOGIES.has(h.couplingTopology as CouplingTopology) ||
    typeof h.twoQubitErrorRate !== 'number' ||
    !Number.isFinite(h.twoQubitErrorRate) ||
    typeof h.readoutErrorRate !== 'number' ||
    !Number.isFinite(h.readoutErrorRate) ||
    typeof h.t1Us !== 'number' ||
    !Number.isFinite(h.t1Us) ||
    typeof h.t2Us !== 'number' ||
    !Number.isFinite(h.t2Us) ||
    typeof h.maxDepthBudget !== 'number' ||
    !Number.isFinite(h.maxDepthBudget)
  ) {
    return null;
  }

  return {
    backendId: backend,
    label: base.label,
    maxQubits: Math.round(Math.max(4, Math.min(256, h.maxQubits))),
    couplingTopology: h.couplingTopology as CouplingTopology,
    twoQubitErrorRate: Math.max(0.0001, Math.min(0.05, h.twoQubitErrorRate)),
    readoutErrorRate: Math.max(0.0005, Math.min(0.08, h.readoutErrorRate)),
    t1Us: Math.round(Math.max(20, Math.min(1000, h.t1Us))),
    t2Us: Math.round(Math.max(15, Math.min(1000, h.t2Us))),
    maxDepthBudget: Math.round(Math.max(20, Math.min(600, h.maxDepthBudget))),
  };
}

function getExecutionStatus() {
  const ibmTokenConfigured = Boolean(process.env.IBM_QUANTUM_TOKEN?.trim());
  const mode = activeJob
    ? 'working'
    : ibmTokenConfigured
    ? 'ibm_quantum_live'
    : 'ibm_simulator';

  return {
    mode,
    backendConnected: true,
    ibmTokenConfigured,
    customTemplate: CUSTOM_ALGORITHM_TEMPLATE,
    activeJob,
    liveRunsCount: liveRunsStore.length,
    timestampUtc: new Date().toISOString(),
  };
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/status', (_req, res) => {
    res.json(getExecutionStatus());
  });

  app.get('/api/schema', (_req, res) => {
    res.json(BACKEND_RESPONSE_SCHEMA);
  });

  app.get('/api/live-runs', (_req, res) => {
    res.json({
      count: liveRunsStore.length,
      runs: liveRunsStore,
    });
  });

  app.get('/api/live-grid/regions', (_req, res) => {
    res.json({
      regions: LIVE_REGIONS.map((r) => ({
        id: r.id,
        name: r.name,
        country: r.country,
        description: r.description,
        nodeCount: r.nodes.length,
      })),
    });
  });

  app.get('/api/live-grid/stream', async (req, res) => {
    const rawRegionId = typeof req.query.regionId === 'string' ? req.query.regionId.trim() : '';
    const region = getLiveRegionById(rawRegionId);
    if (!region) {
      return res.status(400).json({
        error: 'Unknown regionId. Choose one of the allowlisted real-world microgrid regions.',
      });
    }

    const forceRefresh = req.query.refresh === '1';
    const cached = liveStreamCache.get(region.id);
    if (!forceRefresh && cached && cached.expiresAt > Date.now()) {
      return res.json(cached.payload);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000);
    try {
      const targetUrl = buildOpenMeteoUrl(region);
      const upstream = await fetch(targetUrl, {
        signal: controller.signal,
        headers: { Accept: 'application/json' },
      });
      clearTimeout(timeoutId);

      if (!upstream.ok) {
        throw new Error(`Open-Meteo HTTP ${upstream.status}`);
      }
      const rawJson: unknown = await upstream.json();
      const parsed = parseOpenMeteoResponse(rawJson, region);
      if (!parsed) {
        throw new Error('Malformed Open-Meteo minutely_15 response');
      }

      liveStreamCache.set(region.id, {
        expiresAt: Date.now() + OPEN_METEO_CONFIG.cacheTtlMs,
        payload: parsed,
      });
      return res.json(parsed);
    } catch {
      clearTimeout(timeoutId);
      const fallback = buildFallbackStreamPayload(region);
      return res.json(fallback);
    }
  });

  app.post('/api/optimize-grid', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!isValidTopology(body.topology)) {
        return res.status(400).json({ error: 'Invalid grid topology payload.' });
      }
      if (!ALLOWED_BACKENDS.has(body.backend as QiskitBackend)) {
        return res.status(400).json({ error: 'A valid IBM Qiskit backend is required.' });
      }
      if (typeof body.seed !== 'number' || !Number.isFinite(body.seed)) {
        return res.status(400).json({ error: 'A finite numeric seed is required.' });
      }
      const backend = body.backend as QiskitBackend;
      const seed = Math.floor(body.seed);

      const jobId = `job-opt-${Date.now()}`;
      activeJob = {
        jobId,
        algorithm: 'QAOA p=3 Grid Dispatch',
        backend,
        startedAt: new Date().toISOString(),
        status: 'working',
      };

      await new Promise((r) => setTimeout(r, 220));

      const result = runQuantumGridOptimization(body.topology, seed);
      activeJob = null;

      return res.json({
        jobId,
        source: 'live_backend',
        status: getExecutionStatus(),
        ...result,
      });
    } catch {
      activeJob = null;
      return res.status(500).json({ error: 'Grid optimization job failed on backend.' });
    }
  });

  app.post('/api/optimize', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!isValidTopology(body.topology)) {
        return res.status(400).json({ error: 'Invalid grid topology payload (need 3–200 nodes).' });
      }
      if (!ALLOWED_QUANTUM_ALGOS.has(body.quantumAlgorithm as QuantumAlgorithm)) {
        return res.status(400).json({ error: 'A valid quantumAlgorithm is required.' });
      }
      if (!ALLOWED_CLASSICAL_ALGOS.has(body.classicalAlgorithm as ClassicalAlgorithm)) {
        return res.status(400).json({ error: 'A valid classicalAlgorithm is required.' });
      }
      if (!ALLOWED_BACKENDS.has(body.backend as QiskitBackend)) {
        return res.status(400).json({ error: 'A valid IBM Qiskit backend is required.' });
      }
      if (typeof body.shots !== 'number' || !Number.isFinite(body.shots)) {
        return res.status(400).json({ error: 'A valid numeric shots count is required.' });
      }
      if (typeof body.partitionQubits !== 'number' || !Number.isFinite(body.partitionQubits)) {
        return res.status(400).json({ error: 'A valid partitionQubits value is required.' });
      }

      const rawConstraints = Array.isArray(body.constraints) ? body.constraints : [];
      const constraints = rawConstraints.filter((c): c is ConstraintId =>
        ALLOWED_CONSTRAINTS.has(c as ConstraintId)
      );
      if (constraints.length === 0) {
        return res.status(400).json({ error: 'At least one valid operational constraint is required.' });
      }

      const climate = parseClimate(body.climate);
      if (!climate) {
        return res.status(400).json({ error: 'Valid climate conditions are required.' });
      }

      const quantumAlgorithm = body.quantumAlgorithm as QuantumAlgorithm;
      const classicalAlgorithm = body.classicalAlgorithm as ClassicalAlgorithm;
      const backend = body.backend as QiskitBackend;
      const shots = Math.max(128, Math.min(100000, Math.round(body.shots)));
      const partitionQubits = Math.max(4, Math.min(16, Math.round(body.partitionQubits)));

      const jobId = `job-exp-${Date.now()}`;
      activeJob = {
        jobId,
        algorithm: quantumAlgorithm,
        backend,
        startedAt: new Date().toISOString(),
        status: 'working',
      };

      await new Promise((r) => setTimeout(r, 260));

      let result: ExploreRunResult | null = null;
      let usedCustomTemplate = false;

      if (quantumAlgorithm === 'Custom Algorithm (Template)') {
        result = await runCustomQuantumAlgorithm({
          topology: body.topology,
          quantumAlgorithm,
          classicalAlgorithm,
          backend,
          shots,
          constraints,
          climate,
          partitionQubits,
        });
        if (result) {
          usedCustomTemplate = true;
        }
      }

      if (!result) {
        result = runExploreComparison({
          topology: body.topology,
          quantumAlgorithm,
          classicalAlgorithm,
          backend,
          shots,
          constraints,
          climate,
          partitionQubits,
        });
      }

      const liveResult: ExploreRunResult = {
        ...result,
        id: jobId,
        executionSource: usedCustomTemplate ? 'custom_template' : 'ibm_simulator',
      };

      liveRunsStore.unshift(liveResult);
      if (liveRunsStore.length > 50) liveRunsStore.pop();

      activeJob = null;

      return res.json({
        jobId,
        usedCustomTemplate,
        status: getExecutionStatus(),
        result: liveResult,
      });
    } catch {
      activeJob = null;
      return res.status(500).json({ error: 'Optimization job failed on backend.' });
    }
  });

  app.post('/api/qubo-suite', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!isValidTopology(body.topology)) {
        return res.status(400).json({ error: 'Invalid microgrid topology payload (need 3–200 nodes).' });
      }
      if (!ALLOWED_BACKENDS.has(body.backend as QiskitBackend)) {
        return res.status(400).json({ error: 'A valid IBM Qiskit backend is required.' });
      }
      if (!ALLOWED_QUANTUM_ALGOS.has(body.selectedAlgorithm as QuantumAlgorithm)) {
        return res.status(400).json({ error: 'A valid selectedAlgorithm is required.' });
      }
      if (!ALLOWED_OPTIMIZERS.has(body.optimizer as ClassicalOptimizer)) {
        return res.status(400).json({ error: 'A valid classical optimizer is required.' });
      }
      if (typeof body.layersP !== 'number' || !Number.isFinite(body.layersP)) {
        return res.status(400).json({ error: 'A valid layersP value is required.' });
      }
      if (typeof body.shots !== 'number' || !Number.isFinite(body.shots)) {
        return res.status(400).json({ error: 'A valid shots count is required.' });
      }

      const rawConstraints = Array.isArray(body.constraints) ? body.constraints : [];
      const constraints = rawConstraints.filter((c): c is ConstraintId =>
        ALLOWED_CONSTRAINTS.has(c as ConstraintId)
      );
      if (constraints.length === 0) {
        return res.status(400).json({ error: 'At least one valid operational constraint is required.' });
      }

      const backend = body.backend as QiskitBackend;
      const climate = parseClimate(body.climate);
      if (!climate) {
        return res.status(400).json({ error: 'Valid climate conditions are required.' });
      }
      const hardware = parseHardware(body.hardware, backend);
      if (!hardware) {
        return res.status(400).json({ error: 'Valid hardware capabilities are required.' });
      }

      const selectedAlgorithm = body.selectedAlgorithm as QuantumAlgorithm;
      const optimizer = body.optimizer as ClassicalOptimizer;
      const layersP = Math.max(1, Math.min(6, Math.round(body.layersP)));
      const shots = Math.max(128, Math.min(100000, Math.round(body.shots)));

      const jobId = `job-qubo-${Date.now()}`;
      activeJob = {
        jobId,
        algorithm: `QUBO 9-Solver Suite (p=${layersP}, ${optimizer})`,
        backend,
        startedAt: new Date().toISOString(),
        status: 'working',
      };

      await new Promise((r) => setTimeout(r, 180));

      const suite = runAllSolversSuite({
        topology: body.topology,
        climate,
        constraints,
        hardware,
        layersP,
        optimizer,
        shots,
        selectedAlgorithm,
      });

      activeJob = null;
      return res.json({
        jobId,
        status: getExecutionStatus(),
        suite,
      });
    } catch {
      activeJob = null;
      return res.status(500).json({ error: 'QUBO 9-solver suite execution failed on backend.' });
    }
  });

  app.get('/api/qiskit/status', async (_req, res) => {
    try {
      const capabilities = await getQiskitRuntimeCapabilities();
      return res.json(capabilities);
    } catch {
      return res.status(500).json({ error: 'Unable to probe Qiskit runtime capabilities.' });
    }
  });

  app.post('/api/qiskit/execute', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!isValidTopology(body.topology)) {
        return res.status(400).json({ error: 'Invalid microgrid topology payload (need 3–200 nodes).' });
      }
      if (!ALLOWED_BACKENDS.has(body.backend as QiskitBackend)) {
        return res.status(400).json({ error: 'A valid IBM Qiskit backend is required.' });
      }
      if (!ALLOWED_QUANTUM_ALGOS.has(body.algorithm as QuantumAlgorithm)) {
        return res.status(400).json({ error: 'A valid quantum algorithm is required.' });
      }
      if (!ALLOWED_OPTIMIZERS.has(body.optimizer as ClassicalOptimizer)) {
        return res.status(400).json({ error: 'A valid classical optimizer is required.' });
      }
      if (typeof body.layersP !== 'number' || !Number.isFinite(body.layersP)) {
        return res.status(400).json({ error: 'A valid layersP value is required.' });
      }
      if (typeof body.shots !== 'number' || !Number.isFinite(body.shots)) {
        return res.status(400).json({ error: 'A valid shots count is required.' });
      }

      const rawConstraints = Array.isArray(body.constraints) ? body.constraints : [];
      const constraints = rawConstraints.filter((c): c is ConstraintId =>
        ALLOWED_CONSTRAINTS.has(c as ConstraintId)
      );
      if (constraints.length === 0) {
        return res.status(400).json({ error: 'At least one valid operational constraint is required.' });
      }

      const climate = parseClimate(body.climate);
      if (!climate) {
        return res.status(400).json({ error: 'Valid climate conditions are required.' });
      }

      const backend = body.backend as QiskitBackend;
      const targetBackendName =
        typeof body.targetBackendName === 'string' &&
        /^[a-zA-Z0-9_-]{2,64}$/.test(body.targetBackendName.trim())
          ? body.targetBackendName.trim()
          : undefined;
      const algorithm = body.algorithm as QuantumAlgorithm;
      const optimizer = body.optimizer as ClassicalOptimizer;
      const layersP = Math.max(1, Math.min(6, Math.round(body.layersP)));
      const shots = Math.max(128, Math.min(100000, Math.round(body.shots)));

      const capabilities = await getQiskitRuntimeCapabilities();
      if (capabilities.activeMode === 'unconfigured') {
        return res.status(503).json({
          error: capabilities.setupHint,
          capabilities,
        });
      }

      activeJob = {
        jobId: `qiskit-live-${Date.now()}`,
        algorithm: `Real Qiskit ${algorithm} (p=${layersP})`,
        backend,
        startedAt: new Date().toISOString(),
        status: 'working',
      };

      const job = await executeRealQiskitJob({
        topology: body.topology,
        climate,
        constraints,
        backend,
        targetBackendName,
        algorithm,
        optimizer,
        layersP,
        shots,
      });

      activeJob = null;
      return res.json({
        job,
        status: getExecutionStatus(),
      });
    } catch (err) {
      activeJob = null;
      const message = err instanceof Error ? err.message : 'Real Qiskit job execution failed.';
      return res.status(502).json({ error: message });
    }
  });

  app.post('/api/qiskit/execute-batch', async (req, res) => {
    try {
      const body = req.body as Record<string, unknown>;
      if (!isValidTopology(body.topology)) {
        return res.status(400).json({ error: 'Invalid microgrid topology payload (need 3–200 nodes).' });
      }
      if (!ALLOWED_BACKENDS.has(body.backend as QiskitBackend)) {
        return res.status(400).json({ error: 'A valid IBM Qiskit backend is required.' });
      }
      if (typeof body.layersP !== 'number' || !Number.isFinite(body.layersP)) {
        return res.status(400).json({ error: 'A valid layersP value is required.' });
      }
      if (typeof body.shots !== 'number' || !Number.isFinite(body.shots)) {
        return res.status(400).json({ error: 'A valid shots count is required.' });
      }

      const rawConstraints = Array.isArray(body.constraints) ? body.constraints : [];
      const constraints = rawConstraints.filter((c): c is ConstraintId =>
        ALLOWED_CONSTRAINTS.has(c as ConstraintId)
      );
      if (constraints.length === 0) {
        return res.status(400).json({ error: 'At least one valid operational constraint is required.' });
      }

      const climate = parseClimate(body.climate);
      if (!climate) {
        return res.status(400).json({ error: 'Valid climate conditions are required.' });
      }

      const backend = body.backend as QiskitBackend;
      const targetBackendName =
        typeof body.targetBackendName === 'string' &&
        /^[a-zA-Z0-9_-]{2,64}$/.test(body.targetBackendName.trim())
          ? body.targetBackendName.trim()
          : undefined;
      const layersP = Math.max(1, Math.min(6, Math.round(body.layersP)));
      const shots = Math.max(128, Math.min(100000, Math.round(body.shots)));

      const capabilities = await getQiskitRuntimeCapabilities();
      if (!capabilities.ibmCloudRestConfigured || !capabilities.ibmInstanceConfigured) {
        return res.status(503).json({
          error: capabilities.setupHint,
          capabilities,
        });
      }

      activeJob = {
        jobId: `qiskit-batch-${Date.now()}`,
        algorithm: 'IBM QPU 5-Solver Multi-PUB Batch',
        backend,
        startedAt: new Date().toISOString(),
        status: 'working',
      };

      const job = await executeBatchRealQiskitJob({
        topology: body.topology,
        climate,
        constraints,
        backend,
        targetBackendName,
        layersP,
        shots,
      });

      activeJob = null;
      return res.json({
        job,
        status: getExecutionStatus(),
      });
    } catch (err) {
      activeJob = null;
      const message = err instanceof Error ? err.message : 'Batch IBM QPU execution failed.';
      return res.status(502).json({ error: message });
    }
  });

  app.get('/api/qiskit/jobs/:jobId', async (req, res) => {
    try {
      const jobId = String(req.params.jobId ?? '').trim();
      const job = await pollIbmQuantumJob(jobId);
      return res.json({ job });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to poll IBM Quantum job.';
      return res.status(400).json({ error: message });
    }
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`QGrid Studio full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

void startServer();
