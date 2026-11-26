import type {
  BitstringCount,
  ClassicalAlgorithm,
  ClassicalOptimizer,
  HardwareCapabilities,
  QuantumAlgorithm,
} from '../types/grid';

export interface QuboEdgeTerm {
  i: number;
  j: number;
  qij: number;
}

export interface FullQuboProblem {
  n: number;
  linear: Float64Array; // Q_ii
  edges: QuboEdgeTerm[]; // sparse upper-triangular Q_ij (i < j)
  adj: { neighbor: number; qij: number }[][];
}

export interface IsingHamiltonian {
  n: number;
  h: Float64Array; // linear Pauli-Z fields
  J: { i: number; j: number; Jij: number }[]; // quadratic ZZ couplings
  offset: number; // constant energy shift C_0
  energyScale: number; // RMS coupling scale for dimensionless gamma
}

export interface ExactSpectrum {
  n: number;
  dim: number;
  energies: Float64Array;
  eMin: number;
  eMax: number;
  meanEnergy: number;
  bestMask: number;
  worstMask: number;
}

export interface QuantumStatevector {
  n: number;
  dim: number;
  re: Float64Array;
  im: Float64Array;
}

export interface NoiseModelParams {
  circuitDepth: number;
  twoQubitGates: number;
  twoQubitErrorRate: number;
  readoutErrorRate: number;
  t2Us: number;
  enableNoise: boolean;
}

export interface ShotSampleSummary {
  counts: Map<number, number>;
  expectationEnergy: number;
  cvarEnergy: number;
  bestMeasuredMask: number;
  bestMeasuredEnergy: number;
  mostFrequentMask: number;
  mostFrequentEnergy: number;
  circuitFidelity: number;
  effectiveFidelityPct: number;
  topBitstrings: BitstringCount[];
}

export interface RealSolverOutput {
  algorithm: QuantumAlgorithm | ClassicalAlgorithm;
  bits: Uint8Array;
  achievedEnergy: number;
  expectationEnergy: number;
  approxRatio: number;
  runtimeMs: number;
  circuitDepth: number;
  twoQubitGates: number;
  fidelityPct: number;
  iterations: number;
  trajectoryRatios: number[]; // length 15, real progression
  optimalBitstring: string;
  executionMode: 'exact_statevector' | 'partitioned_statevector' | 'ising_dynamics' | 'classical_qubo';
  optimalParams?: number[];
  sampleSummary?: ShotSampleSummary;
}

export function createSeededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function nowMs(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

export function bitsToString(bits: Uint8Array, maxChars = 12): string {
  const limit = Math.min(bits.length, maxChars);
  let out = '';
  for (let i = 0; i < limit; i++) {
    out += bits[i] ? '1' : '0';
  }
  return `|${out}${bits.length > maxChars ? '…' : ''}⟩`;
}

export function maskToBits(mask: number, n: number): Uint8Array {
  const bits = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    bits[i] = (mask >> i) & 1;
  }
  return bits;
}

export function bitsToMask(bits: Uint8Array): number {
  let mask = 0;
  for (let i = 0; i < bits.length && i < 30; i++) {
    if (bits[i]) mask |= 1 << i;
  }
  return mask;
}

export function buildFullQuboProblem(
  n: number,
  linearTerms: number[],
  edgeTerms: { i: number; j: number; qij: number }[]
): FullQuboProblem {
  const linear = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    linear[i] = linearTerms[i] ?? 0;
  }

  // Merge duplicate edges into clean upper-triangular sparse form
  const edgeMap = new Map<string, QuboEdgeTerm>();
  for (const e of edgeTerms) {
    if (e.i === e.j || e.i < 0 || e.j < 0 || e.i >= n || e.j >= n) continue;
    const u = Math.min(e.i, e.j);
    const v = Math.max(e.i, e.j);
    const key = `${u}:${v}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.qij += e.qij;
    } else {
      edgeMap.set(key, { i: u, j: v, qij: e.qij });
    }
  }

  const edges = Array.from(edgeMap.values()).filter((e) => Math.abs(e.qij) > 1e-12);
  const adj: { neighbor: number; qij: number }[][] = Array.from({ length: n }, () => []);
  for (const e of edges) {
    adj[e.i].push({ neighbor: e.j, qij: e.qij });
    adj[e.j].push({ neighbor: e.i, qij: e.qij });
  }

  return { n, linear, edges, adj };
}

/**
 * Exact QUBO evaluation:
 *   C(x) = sum_i Q_ii x_i + sum_{i < j} Q_ij x_i x_j
 */
export function evaluateQuboBits(problem: FullQuboProblem, bits: Uint8Array): number {
  let energy = 0;
  for (let i = 0; i < problem.n; i++) {
    if (bits[i]) energy += problem.linear[i];
  }
  for (let k = 0; k < problem.edges.length; k++) {
    const e = problem.edges[k];
    if (bits[e.i] && bits[e.j]) energy += e.qij;
  }
  return energy;
}

/**
 * Exact delta energy when flipping bit i in bits:
 *   ΔE_i = (1 - 2 x_i) * (Q_ii + sum_{j in N(i)} Q_ij x_j)
 */
export function deltaEnergyFlip(problem: FullQuboProblem, bits: Uint8Array, i: number): number {
  let localField = problem.linear[i];
  const neighbors = problem.adj[i];
  for (let k = 0; k < neighbors.length; k++) {
    if (bits[neighbors[k].neighbor]) {
      localField += neighbors[k].qij;
    }
  }
  return bits[i] ? -localField : localField;
}

/**
 * Exact QUBO -> Ising Problem Hamiltonian H_C mapping via x_i = (I - Z_i) / 2:
 *   H_C = C_0 I + sum_i h_i Z_i + sum_{i<j} J_ij Z_i Z_j
 * where:
 *   h_i  = -Q_ii / 2 - (1/4) sum_{j != i} Q_ij
 *   J_ij = Q_ij / 4
 *   C_0  = (1/2) sum_i Q_ii + (1/4) sum_{i < j} Q_ij
 */
export function quboToIsing(problem: FullQuboProblem): IsingHamiltonian {
  const { n, linear, edges } = problem;
  const h = new Float64Array(n);
  let offset = 0;

  for (let i = 0; i < n; i++) {
    h[i] = -0.5 * linear[i];
    offset += 0.5 * linear[i];
  }

  const J: { i: number; j: number; Jij: number }[] = [];
  for (let k = 0; k < edges.length; k++) {
    const { i, j, qij } = edges[k];
    const Jij = 0.25 * qij;
    J.push({ i, j, Jij });
    h[i] -= Jij;
    h[j] -= Jij;
    offset += Jij;
  }

  // True spectral standard deviation of H_C over uniform states:
  // Var(H_C) = sum_i h_i^2 + sum_{i<j} J_ij^2  (exact Pauli-Z orthogonality!)
  // Normalizing gamma by sigma_H prevents 2*pi phase aliasing in exp(-i gamma H_C).
  let varSum = 0;
  for (let i = 0; i < n; i++) {
    varSum += h[i] * h[i];
  }
  for (let k = 0; k < J.length; k++) {
    varSum += J[k].Jij * J[k].Jij;
  }
  const energyScale = Math.max(0.5, Math.sqrt(varSum));

  return { n, h, J, offset, energyScale };
}

/**
 * Exact Ising Hamiltonian eigenvalue for spin vector z_i = 1 - 2 x_i in {+1, -1}.
 */
export function evaluateIsingFromBits(ising: IsingHamiltonian, bits: Uint8Array): number {
  let e = ising.offset;
  for (let i = 0; i < ising.n; i++) {
    const zi = bits[i] ? -1 : 1;
    e += ising.h[i] * zi;
  }
  for (let k = 0; k < ising.J.length; k++) {
    const { i, j, Jij } = ising.J[k];
    const zi = bits[i] ? -1 : 1;
    const zj = bits[j] ? -1 : 1;
    e += Jij * zi * zj;
  }
  return e;
}

/**
 * Exact brute-force spectrum for n <= 12 (dim = 2^n <= 4096) in O(2^n * avg_deg).
 */
export function computeExactSpectrum(problem: FullQuboProblem): ExactSpectrum {
  const n = problem.n;
  if (n > 12) {
    throw new Error(`Exact 2^n spectrum supports n <= 12 (received n=${n}).`);
  }
  const dim = 1 << n;
  const energies = new Float64Array(dim);
  energies[0] = 0;

  let eMin = 0;
  let eMax = 0;
  let bestMask = 0;
  let worstMask = 0;
  let sum = 0;

  for (let s = 1; s < dim; s++) {
    const lsb = s & -s;
    const i = 31 - Math.clz32(lsb);
    const prev = s ^ lsb;
    let e = energies[prev] + problem.linear[i];
    const neighbors = problem.adj[i];
    for (let k = 0; k < neighbors.length; k++) {
      const nb = neighbors[k];
      if ((prev & (1 << nb.neighbor)) !== 0) {
        e += nb.qij;
      }
    }
    energies[s] = e;
    sum += e;
    if (e < eMin) {
      eMin = e;
      bestMask = s;
    }
    if (e > eMax) {
      eMax = e;
      worstMask = s;
    }
  }

  return {
    n,
    dim,
    energies,
    eMin,
    eMax,
    meanEnergy: sum / dim,
    bestMask,
    worstMask,
  };
}

export function computeApproxRatio(energy: number, eMin: number, eMax: number): number {
  const span = eMax - eMin;
  if (span <= 1e-9) return 1.0;
  return Math.max(0, Math.min(1, (eMax - energy) / span));
}

// -----------------------------------------------------------------------------
// Exact Complex Statevector Operations (|ψ⟩ ∈ C^{2^n})
// -----------------------------------------------------------------------------

export function allocateStatevector(n: number): QuantumStatevector {
  const dim = 1 << n;
  return {
    n,
    dim,
    re: new Float64Array(dim),
    im: new Float64Array(dim),
  };
}

export function setPlusState(sv: QuantumStatevector): void {
  const amp = 1 / Math.sqrt(sv.dim);
  sv.re.fill(amp);
  sv.im.fill(0);
}

export function setZeroState(sv: QuantumStatevector): void {
  sv.re.fill(0);
  sv.im.fill(0);
  sv.re[0] = 1;
}

export function setBasisState(sv: QuantumStatevector, mask: number): void {
  sv.re.fill(0);
  sv.im.fill(0);
  sv.re[mask] = 1;
}

/**
 * Exact Problem Hamiltonian phase separator:
 *   U_C(γ) |x⟩ = exp(-i γ E(x)) |x⟩
 */
export function applyCostUnitary(sv: QuantumStatevector, energies: Float64Array, gamma: number): void {
  const { dim, re, im } = sv;
  for (let s = 0; s < dim; s++) {
    const angle = -gamma * energies[s];
    const c = Math.cos(angle);
    const sn = Math.sin(angle);
    const r = re[s];
    const m = im[s];
    re[s] = r * c - m * sn;
    im[s] = r * sn + m * c;
  }
}

/**
 * Exact Transverse-Field X-Mixer Hamiltonian unitary:
 *   U_M(β) = exp(-i β Σ_q X_q) = ∏_q R_X(2β)_q
 */
export function applyXMixer(sv: QuantumStatevector, beta: number): void {
  const { n, dim, re, im } = sv;
  const c = Math.cos(beta);
  const s = Math.sin(beta);
  for (let q = 0; q < n; q++) {
    const step = 1 << q;
    const stride = step << 1;
    for (let base = 0; base < dim; base += stride) {
      for (let off = 0; off < step; off++) {
        const i0 = base + off;
        const i1 = i0 + step;
        const r0 = re[i0];
        const m0 = im[i0];
        const r1 = re[i1];
        const m1 = im[i1];
        // [[cos β, -i sin β], [-i sin β, cos β]]
        re[i0] = c * r0 + s * m1;
        im[i0] = c * m0 - s * r1;
        re[i1] = c * r1 + s * m0;
        im[i1] = c * m1 - s * r0;
      }
    }
  }
}

/**
 * Exact single-qubit R_Y(theta_q) layer across qubits.
 * R_Y(θ) = [[cos(θ/2), -sin(θ/2)], [sin(θ/2), cos(θ/2)]]
 */
export function applyRYLayer(sv: QuantumStatevector, thetas: Float64Array | number[]): void {
  const { n, dim, re, im } = sv;
  for (let q = 0; q < n; q++) {
    const half = 0.5 * (thetas[q] ?? 0);
    const c = Math.cos(half);
    const s = Math.sin(half);
    const step = 1 << q;
    const stride = step << 1;
    for (let base = 0; base < dim; base += stride) {
      for (let off = 0; off < step; off++) {
        const i0 = base + off;
        const i1 = i0 + step;
        const r0 = re[i0];
        const m0 = im[i0];
        const r1 = re[i1];
        const m1 = im[i1];
        re[i0] = c * r0 - s * r1;
        im[i0] = c * m0 - s * m1;
        re[i1] = s * r0 + c * r1;
        im[i1] = s * m0 + c * m1;
      }
    }
  }
}

/**
 * Exact linear-chain CNOT entanglement layer CX(q, q+1) for Hardware-Efficient VQA.
 */
export function applyCXLinearChain(sv: QuantumStatevector): void {
  const { n, dim, re, im } = sv;
  for (let q = 0; q < n - 1; q++) {
    const ctrlBit = 1 << q;
    const tgtBit = 1 << (q + 1);
    for (let s = 0; s < dim; s++) {
      if ((s & ctrlBit) !== 0 && (s & tgtBit) === 0) {
        const flipped = s | tgtBit;
        const tr = re[s];
        const ti = im[s];
        re[s] = re[flipped];
        im[s] = im[flipped];
        re[flipped] = tr;
        im[flipped] = ti;
      }
    }
  }
}

/**
 * Computes exact statevector expectation <ψ|H_C|ψ> and optional depolarizing-damped expectation.
 */
export function computeExactExpectation(
  sv: QuantumStatevector,
  energies: Float64Array,
  depolarizingFidelity = 1.0,
  meanEnergy = 0
): number {
  let expVal = 0;
  for (let s = 0; s < sv.dim; s++) {
    const p = sv.re[s] * sv.re[s] + sv.im[s] * sv.im[s];
    expVal += p * energies[s];
  }
  if (depolarizingFidelity >= 0.999999) return expVal;
  return depolarizingFidelity * expVal + (1 - depolarizingFidelity) * meanEnergy;
}

/**
 * Physics-based circuit fidelity model from real gate counts and hardware specs.
 */
export function computeCircuitFidelity(noise: NoiseModelParams, nQubits: number): {
  circuitFidelity: number;
  effectiveFidelityPct: number;
} {
  if (!noise.enableNoise) {
    return { circuitFidelity: 1.0, effectiveFidelityPct: 99.9 };
  }
  // 2Q gate infidelity + T2 decoherence (typical ~0.35 us per entangling depth layer)
  const gateFidelity = Math.exp(-noise.twoQubitGates * noise.twoQubitErrorRate);
  const cohFidelity = Math.exp(-(noise.circuitDepth * 0.35) / Math.max(15, noise.t2Us));
  const circuitFidelity = Math.max(0.04, Math.min(1.0, gateFidelity * cohFidelity));
  const readoutFactor = Math.pow(Math.max(0.5, 1 - noise.readoutErrorRate), nQubits);
  const effectiveFidelityPct = Math.max(5.0, Math.min(99.9, circuitFidelity * readoutFactor * 100));
  return { circuitFidelity, effectiveFidelityPct };
}

/**
 * Samples real measurement shots from Born probabilities |ψ[s]|^2 with optional
 * hardware depolarizing damping + independent per-qubit bit-flip readout noise.
 */
export function sampleStatevectorShots(
  sv: QuantumStatevector,
  spectrum: ExactSpectrum,
  shots: number,
  noise: NoiseModelParams,
  seed: number,
  cvarAlpha = 0.25
): ShotSampleSummary {
  const rng = createSeededRng(seed);
  const { circuitFidelity, effectiveFidelityPct } = computeCircuitFidelity(noise, sv.n);
  const dim = sv.dim;
  const uniformShare = (1 - circuitFidelity) / dim;

  // Build cumulative distribution function (CDF)
  const cdf = new Float64Array(dim);
  let running = 0;
  for (let s = 0; s < dim; s++) {
    const pIdeal = sv.re[s] * sv.re[s] + sv.im[s] * sv.im[s];
    const pNoisy = circuitFidelity * pIdeal + uniformShare;
    running += pNoisy;
    cdf[s] = running;
  }
  if (running > 0) {
    for (let s = 0; s < dim; s++) cdf[s] /= running;
  }
  cdf[dim - 1] = 1.0;

  const counts = new Map<number, number>();
  const roErr = noise.enableNoise ? noise.readoutErrorRate : 0;

  for (let k = 0; k < shots; k++) {
    const u = rng();
    // Binary search in CDF
    let lo = 0;
    let hi = dim - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (cdf[mid] < u) lo = mid + 1;
      else hi = mid;
    }
    let measured = lo;
    if (roErr > 0) {
      for (let q = 0; q < sv.n; q++) {
        if (rng() < roErr) {
          measured ^= 1 << q;
        }
      }
    }
    counts.set(measured, (counts.get(measured) ?? 0) + 1);
  }

  let totalEnergy = 0;
  let bestMeasuredMask = 0;
  let bestMeasuredEnergy = Infinity;
  let mostFrequentMask = 0;
  let mostFrequentCount = -1;

  const entries: { mask: number; count: number; energy: number }[] = [];
  for (const [mask, count] of counts.entries()) {
    const energy = spectrum.energies[mask];
    totalEnergy += energy * count;
    entries.push({ mask, count, energy });
    if (energy < bestMeasuredEnergy) {
      bestMeasuredEnergy = energy;
      bestMeasuredMask = mask;
    }
    if (count > mostFrequentCount) {
      mostFrequentCount = count;
      mostFrequentMask = mask;
    }
  }

  const expectationEnergy = totalEnergy / Math.max(1, shots);

  // True CVaR_alpha (lowest alpha-fraction of shots by energy)
  entries.sort((a, b) => a.energy - b.energy);
  const cvarTargetShots = Math.max(1, Math.ceil(shots * cvarAlpha));
  let cvarAccumShots = 0;
  let cvarAccumEnergy = 0;
  for (const entry of entries) {
    const take = Math.min(entry.count, cvarTargetShots - cvarAccumShots);
    if (take <= 0) break;
    cvarAccumEnergy += take * entry.energy;
    cvarAccumShots += take;
  }
  const cvarEnergy = cvarAccumEnergy / Math.max(1, cvarAccumShots);

  // Top 8 most frequently measured bitstrings for histogram display
  const byFreq = [...entries].sort((a, b) => b.count - a.count);
  const topSlice = byFreq.slice(0, 8);
  const topBitstrings: BitstringCount[] = topSlice.map((entry) => ({
    bitstring: `|${entry.mask.toString(2).padStart(sv.n, '0')}⟩`,
    probability: Number((entry.count / shots).toFixed(4)),
    counts: entry.count,
    energyCost: Number(entry.energy.toFixed(2)),
    isOptimal: entry.mask === spectrum.bestMask || Math.abs(entry.energy - spectrum.eMin) < 1e-6,
  }));

  return {
    counts,
    expectationEnergy,
    cvarEnergy,
    bestMeasuredMask,
    bestMeasuredEnergy,
    mostFrequentMask,
    mostFrequentEnergy: spectrum.energies[mostFrequentMask],
    circuitFidelity,
    effectiveFidelityPct,
    topBitstrings,
  };
}

// -----------------------------------------------------------------------------
// Real Classical Optimizers (COBYLA, SPSA, Powell, NELDER_MEAD)
// -----------------------------------------------------------------------------

interface OptimizeResult {
  bestParams: number[];
  bestVal: number;
  history: number[]; // best value at each iteration
  evaluations: number;
}

function resampleTrajectory(values: number[], targetLen = 15): number[] {
  if (values.length === 0) return Array(targetLen).fill(0);
  if (values.length === 1) return Array(targetLen).fill(values[0]);
  const out: number[] = [];
  for (let i = 0; i < targetLen; i++) {
    const pos = (i / (targetLen - 1)) * (values.length - 1);
    const idx = Math.min(values.length - 1, Math.round(pos));
    out.push(values[idx]);
  }
  return out;
}

function optimizeClassical(
  objective: (params: number[]) => number,
  initial: number[],
  method: ClassicalOptimizer,
  maxSteps: number,
  seed: number
): OptimizeResult {
  const d = initial.length;
  const rng = createSeededRng(seed);
  let evals = 0;
  const evalFn = (x: number[]) => {
    evals++;
    return objective(x);
  };

  let bestParams = [...initial];
  let bestVal = evalFn(bestParams);
  const history: number[] = [bestVal];

  if (method === 'SPSA') {
    const cur = [...initial];
    const a0 = 0.28;
    const c0 = 0.16;
    const A = Math.max(2, maxSteps * 0.2);
    for (let k = 1; k <= maxSteps; k++) {
      const ak = a0 / Math.pow(k + A, 0.602);
      const ck = c0 / Math.pow(k, 0.101);
      const delta = Array.from({ length: d }, () => (rng() < 0.5 ? -1 : 1));
      const plus = cur.map((v, i) => v + ck * delta[i]);
      const minus = cur.map((v, i) => v - ck * delta[i]);
      const fPlus = evalFn(plus);
      const fMinus = evalFn(minus);
      const gradScale = (fPlus - fMinus) / (2 * ck);
      for (let i = 0; i < d; i++) {
        const step = Math.max(-0.45, Math.min(0.45, ak * gradScale * delta[i]));
        cur[i] -= step;
      }
      if (fPlus < bestVal) {
        bestVal = fPlus;
        bestParams = [...plus];
      }
      if (fMinus < bestVal) {
        bestVal = fMinus;
        bestParams = [...minus];
      }
      const fCur = evalFn(cur);
      if (fCur < bestVal) {
        bestVal = fCur;
        bestParams = [...cur];
      }
      history.push(bestVal);
    }
    return { bestParams, bestVal, history, evaluations: evals };
  }

  if (method === 'NELDER_MEAD') {
    const simplex: { x: number[]; f: number }[] = [{ x: [...initial], f: bestVal }];
    for (let i = 0; i < d; i++) {
      const xi = [...initial];
      xi[i] += 0.35;
      const fi = evalFn(xi);
      simplex.push({ x: xi, f: fi });
      if (fi < bestVal) {
        bestVal = fi;
        bestParams = [...xi];
      }
    }

    for (let k = 0; k < maxSteps; k++) {
      simplex.sort((a, b) => a.f - b.f);
      if (simplex[0].f < bestVal) {
        bestVal = simplex[0].f;
        bestParams = [...simplex[0].x];
      }
      const centroid = Array(d).fill(0);
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) centroid[j] += simplex[i].x[j] / d;
      }
      const worst = simplex[d];
      const reflected = centroid.map((c, j) => c + (c - worst.x[j]));
      const fRef = evalFn(reflected);

      if (fRef < simplex[0].f) {
        const expanded = centroid.map((c, j) => c + 2 * (reflected[j] - c));
        const fExp = evalFn(expanded);
        simplex[d] = fExp < fRef ? { x: expanded, f: fExp } : { x: reflected, f: fRef };
      } else if (fRef < simplex[d - 1].f) {
        simplex[d] = { x: reflected, f: fRef };
      } else {
        const contracted = centroid.map((c, j) => c + 0.5 * (worst.x[j] - c));
        const fCon = evalFn(contracted);
        if (fCon < worst.f) {
          simplex[d] = { x: contracted, f: fCon };
        } else {
          for (let i = 1; i <= d; i++) {
            const shrunk = simplex[0].x.map((b, j) => b + 0.5 * (simplex[i].x[j] - b));
            simplex[i] = { x: shrunk, f: evalFn(shrunk) };
          }
        }
      }
      simplex.sort((a, b) => a.f - b.f);
      if (simplex[0].f < bestVal) {
        bestVal = simplex[0].f;
        bestParams = [...simplex[0].x];
      }
      history.push(bestVal);
    }
    return { bestParams, bestVal, history, evaluations: evals };
  }

  if (method === 'Powell') {
    const cur = [...initial];
    let curVal = bestVal;
    let stepSize = 0.42;
    const passes = Math.max(2, Math.ceil(maxSteps / Math.max(1, d)));
    for (let pass = 0; pass < passes; pass++) {
      let improved = false;
      for (let i = 0; i < d; i++) {
        const plus = [...cur];
        plus[i] += stepSize;
        const fPlus = evalFn(plus);
        const minus = [...cur];
        minus[i] -= stepSize;
        const fMinus = evalFn(minus);

        if (fPlus < curVal && fPlus <= fMinus) {
          cur[i] = plus[i];
          curVal = fPlus;
          improved = true;
        } else if (fMinus < curVal) {
          cur[i] = minus[i];
          curVal = fMinus;
          improved = true;
        }
        if (curVal < bestVal) {
          bestVal = curVal;
          bestParams = [...cur];
        }
        history.push(bestVal);
      }
      if (!improved) stepSize *= 0.52;
      else stepSize *= 0.85;
    }
    return { bestParams, bestVal, history, evaluations: evals };
  }

  // Default: COBYLA-style derivative-free trust-region pattern search
  const cur = [...initial];
  let curVal = bestVal;
  let radius = 0.44;
  for (let iter = 0; iter < maxSteps; iter++) {
    let bestDirIdx = -1;
    let bestSign = 0;
    let candidateBest = curVal;

    // Evaluate axis & coupled trust-region moves
    const coord = iter % d;
    for (const sign of [1, -1]) {
      const trial = [...cur];
      trial[coord] += sign * radius;
      const val = evalFn(trial);
      if (val < candidateBest) {
        candidateBest = val;
        bestDirIdx = coord;
        bestSign = sign;
      }
    }
    if (d >= 2) {
      const nextCoord = (coord + 1) % d;
      const diag = [...cur];
      diag[coord] += radius * 0.7;
      diag[nextCoord] -= radius * 0.7;
      const val = evalFn(diag);
      if (val < candidateBest) {
        candidateBest = val;
        cur[coord] = diag[coord];
        cur[nextCoord] = diag[nextCoord];
        curVal = val;
        bestDirIdx = -2;
      }
    }

    if (bestDirIdx >= 0) {
      cur[bestDirIdx] += bestSign * radius;
      curVal = candidateBest;
    } else if (bestDirIdx === -1) {
      radius = Math.max(0.025, radius * 0.78);
    }

    if (curVal < bestVal) {
      bestVal = curVal;
      bestParams = [...cur];
    }
    history.push(bestVal);
  }
  return { bestParams, bestVal, history, evaluations: evals };
}

// -----------------------------------------------------------------------------
// Exact Subproblem Quantum & Classical Solvers (n <= 12)
// -----------------------------------------------------------------------------

function computeGateCounts(
  n: number,
  edgeCount: number,
  layersP: number,
  swapMul: number,
  variant: QuantumAlgorithm
): { depth: number; twoQubitGates: number } {
  if (variant === 'Ising Machine') return { depth: 0, twoQubitGates: 0 };
  const activeEdges = Math.max(n - 1, edgeCount);
  if (variant === 'BF-DCQO') {
    // Shallow counterdiabatic: uses fewer layers (ceil(p/2)) with local Y gauge terms
    const effP = Math.max(1, Math.ceil(layersP * 0.55));
    const twoQ = Math.round(activeEdges * effP * 2 * swapMul * 0.75);
    const depth = Math.max(4, Math.round((effP * Math.ceil((2 * activeEdges) / Math.max(1, n)) + effP * 2) * swapMul));
    return { depth, twoQubitGates: twoQ };
  }
  if (variant === 'VQA') {
    // Hardware-efficient linear chain: zero SWAP routing overhead
    const twoQ = Math.max(n - 1, (n - 1) * layersP);
    const depth = Math.max(4, layersP * (Math.min(n, 6) + 2) + 2);
    return { depth, twoQubitGates: twoQ };
  }
  if (variant === 'QITE') {
    // Domain-truncated QITE requires deeper multi-qubit Pauli block compilation
    const twoQ = Math.round(activeEdges * layersP * 2.8 * swapMul);
    const depth = Math.max(6, Math.round(layersP * (Math.ceil((2.5 * activeEdges) / Math.max(1, n)) + 4) * swapMul * 1.25));
    return { depth, twoQubitGates: twoQ };
  }
  if (variant === 'VarQITE') {
    const twoQ = Math.round(activeEdges * layersP * 1.8 * swapMul);
    const depth = Math.max(5, Math.round(layersP * (Math.ceil((2 * activeEdges) / Math.max(1, n)) + 2) * swapMul * 0.9));
    return { depth, twoQubitGates: twoQ };
  }
  if (variant === 'GAS') {
    // Grover oracle + multi-controlled diffuser incurs significant circuit depth
    const groverIters = Math.max(2, Math.min(5, Math.round(Math.sqrt(n))));
    const twoQ = Math.round((activeEdges * 2 + n * 4) * groverIters * swapMul);
    const depth = Math.max(8, Math.round((n * 3 + Math.ceil((2 * activeEdges) / Math.max(1, n))) * groverIters * swapMul));
    return { depth, twoQubitGates: twoQ };
  }
  if (variant === 'QE-MCMC') {
    const twoQ = Math.round(activeEdges * Math.max(1, layersP) * 1.9 * swapMul);
    const depth = Math.max(5, Math.round(layersP * (Math.ceil((2 * activeEdges) / Math.max(1, n)) + 2) * swapMul));
    return { depth, twoQubitGates: twoQ };
  }
  // Standard QAOA & CVaR-QAOA
  const twoQ = Math.round(activeEdges * layersP * 2 * swapMul);
  const depth = Math.max(4, Math.round(layersP * (Math.ceil((2 * activeEdges) / Math.max(1, n)) + 2) * swapMul + 2));
  return { depth, twoQubitGates: twoQ };
}

function makeNoiseParams(
  depth: number,
  twoQubitGates: number,
  hardware: HardwareCapabilities
): NoiseModelParams {
  const enableNoise =
    !hardware.backendId.includes('aer_simulator') ||
    hardware.twoQubitErrorRate > 0.0005 ||
    hardware.readoutErrorRate > 0.002;
  return {
    circuitDepth: depth,
    twoQubitGates,
    twoQubitErrorRate: hardware.twoQubitErrorRate,
    readoutErrorRate: hardware.readoutErrorRate,
    t2Us: hardware.t2Us,
    enableNoise,
  };
}

/**
 * Standard QAOA or CVaR-QAOA on exact 2^n statevector (n <= 12).
 * Uses linear adiabatic ramp warm-start (Zhou et al., PRX 2020) followed by
 * real classical optimizer tuning (COBYLA / SPSA / Powell / NELDER_MEAD).
 */
export function runExactQaoaStatevector(params: {
  problem: FullQuboProblem;
  spectrum: ExactSpectrum;
  ising: IsingHamiltonian;
  layersP: number;
  optimizer: ClassicalOptimizer;
  shots: number;
  hardware: HardwareCapabilities;
  swapMul: number;
  isCvar: boolean;
  seed: number;
}): RealSolverOutput {
  const t0 = nowMs();
  const { problem, spectrum, ising, layersP, optimizer, shots, hardware, swapMul, isCvar, seed } = params;
  const p = Math.max(1, Math.min(6, layersP));
  const algo: QuantumAlgorithm = isCvar ? 'CVaR-QAOA' : 'QAOA';
  const { depth, twoQubitGates } = computeGateCounts(problem.n, problem.edges.length, p, swapMul, algo);
  const noise = makeNoiseParams(depth, twoQubitGates, hardware);
  const { circuitFidelity } = computeCircuitFidelity(noise, problem.n);

  const sv = allocateStatevector(problem.n);
  const scale = ising.energyScale;

  const prepareState = (theta: number[]) => {
    setPlusState(sv);
    for (let l = 0; l < p; l++) {
      const gamma = theta[l] / scale;
      const beta = theta[p + l];
      applyCostUnitary(sv, spectrum.energies, gamma);
      applyXMixer(sv, beta);
    }
  };

  // Pre-sort state indices by energy once if CVaR is used (exact CVaR over statevector distribution)
  let sortedStates: Int32Array | null = null;
  if (isCvar) {
    const idx = Array.from({ length: spectrum.dim }, (_, s) => s);
    idx.sort((a, b) => spectrum.energies[a] - spectrum.energies[b]);
    sortedStates = Int32Array.from(idx);
  }

  const evalObjective = (theta: number[]): number => {
    prepareState(theta);
    if (!isCvar || !sortedStates) {
      return computeExactExpectation(sv, spectrum.energies, circuitFidelity, spectrum.meanEnergy);
    }
    // Exact CVaR_{0.25} on the noise-damped probability distribution
    const alpha = 0.25;
    const uniformShare = (1 - circuitFidelity) / spectrum.dim;
    let mass = 0;
    let weightedE = 0;
    for (let k = 0; k < sortedStates.length; k++) {
      const s = sortedStates[k];
      const pNoisy = circuitFidelity * (sv.re[s] * sv.re[s] + sv.im[s] * sv.im[s]) + uniformShare;
      const take = Math.min(pNoisy, alpha - mass);
      if (take <= 0) break;
      weightedE += take * spectrum.energies[s];
      mass += take;
      if (mass >= alpha - 1e-12) break;
    }
    return weightedE / Math.max(1e-9, mass);
  };

  // Adiabatic linear schedule initialization: gamma ramps up, beta ramps down
  // With sigma_H = sqrt(Var(H_C)), natural QAOA angles lie in gamma in [0.4, 2.2], beta in [0.15, 0.75]
  const initTheta: number[] = [];
  for (let l = 0; l < p; l++) {
    const frac = (l + 0.5) / p;
    initTheta.push(0.45 + 1.35 * frac);
  }
  for (let l = 0; l < p; l++) {
    const frac = (l + 0.5) / p;
    initTheta.push(0.72 * (1 - 0.68 * frac));
  }

  const maxSteps = Math.max(14, Math.min(28, 12 + p * 3));
  const opt = optimizeClassical(evalObjective, initTheta, optimizer, maxSteps, seed);

  // Final shot sampling on optimized parameters
  prepareState(opt.bestParams);
  const sample = sampleStatevectorShots(sv, spectrum, shots, noise, seed + 101, 0.25);

  const evalEnergy = isCvar ? sample.cvarEnergy : sample.expectationEnergy;
  const chosenMask = isCvar ? sample.bestMeasuredMask : sample.mostFrequentMask;
  const chosenBits = maskToBits(chosenMask, problem.n);
  const achievedEnergy = spectrum.energies[chosenMask];
  const approxRatio = computeApproxRatio(evalEnergy, spectrum.eMin, spectrum.eMax);

  const trajectoryRatios = resampleTrajectory(
    opt.history.map((val) => computeApproxRatio(val, spectrum.eMin, spectrum.eMax)),
    15
  );

  const runtimeMs = Math.max(0.1, Number((nowMs() - t0).toFixed(1)));
  return {
    algorithm: algo,
    bits: chosenBits,
    achievedEnergy,
    expectationEnergy: evalEnergy,
    approxRatio,
    runtimeMs,
    circuitDepth: depth,
    twoQubitGates,
    fidelityPct: Number(sample.effectiveFidelityPct.toFixed(1)),
    iterations: opt.history.length,
    trajectoryRatios,
    optimalBitstring: bitsToString(chosenBits),
    executionMode: 'exact_statevector',
    optimalParams: opt.bestParams,
    sampleSummary: sample,
  };
}

/**
 * BF-DCQO: Bias-Field Digitized Counterdiabatic Quantum Optimization.
 * Runs 3 iterative bias-field feedback rounds with shallow cost + X-mixer +
 * first-order counterdiabatic Y-rotations proportional to effective local fields.
 */
export function runExactBfDcqoStatevector(params: {
  problem: FullQuboProblem;
  spectrum: ExactSpectrum;
  ising: IsingHamiltonian;
  layersP: number;
  optimizer: ClassicalOptimizer;
  shots: number;
  hardware: HardwareCapabilities;
  swapMul: number;
  seed: number;
}): RealSolverOutput {
  const t0 = nowMs();
  const { problem, spectrum, ising, layersP, optimizer, shots, hardware, swapMul, seed } = params;
  const effP = Math.max(1, Math.min(3, Math.ceil(layersP * 0.55)));
  const { depth, twoQubitGates } = computeGateCounts(problem.n, problem.edges.length, layersP, swapMul, 'BF-DCQO');
  const noise = makeNoiseParams(depth, twoQubitGates, hardware);
  const { circuitFidelity } = computeCircuitFidelity(noise, problem.n);

  const sv = allocateStatevector(problem.n);
  const biasField = Float64Array.from(ising.h);
  const scale = ising.energyScale;
  const history: number[] = [];

  let bestParams = [0.42, 0.48, 0.35]; // [gamma, beta, alpha_cd]
  const yAngles = new Float64Array(problem.n);

  const prepareWithBias = (theta: number[]) => {
    setPlusState(sv);
    for (let l = 0; l < effP; l++) {
      const frac = (l + 0.5) / effP;
      applyCostUnitary(sv, spectrum.energies, (theta[0] * frac) / scale);
      applyXMixer(sv, theta[1] * (1 - 0.5 * frac));
      // Counterdiabatic first-order adiabatic gauge potential R_Y(2 * alpha * h_eff)
      for (let q = 0; q < problem.n; q++) {
        yAngles[q] = (2 * theta[2] * biasField[q]) / scale;
      }
      applyRYLayer(sv, yAngles);
    }
  };

  // 3 Bias-Field feedback iterations
  for (let round = 0; round < 3; round++) {
    const opt = optimizeClassical(
      (th) => {
        prepareWithBias(th);
        return computeExactExpectation(sv, spectrum.energies, circuitFidelity, spectrum.meanEnergy);
      },
      bestParams,
      optimizer,
      8,
      seed + round * 37
    );
    bestParams = opt.bestParams;
    for (const hVal of opt.history) history.push(hVal);

    // Measure <Z_q> expectation values to update longitudinal bias fields h_q <- h_q + eta * <Z_q>
    prepareWithBias(bestParams);
    for (let q = 0; q < problem.n; q++) {
      let expZ = 0;
      const bit = 1 << q;
      for (let s = 0; s < sv.dim; s++) {
        const pState = sv.re[s] * sv.re[s] + sv.im[s] * sv.im[s];
        expZ += (s & bit) === 0 ? pState : -pState;
      }
      biasField[q] = 0.72 * biasField[q] + 0.45 * expZ * scale;
    }
  }

  prepareWithBias(bestParams);
  const sample = sampleStatevectorShots(sv, spectrum, shots, noise, seed + 203, 0.25);
  const chosenMask = sample.mostFrequentMask;
  const chosenBits = maskToBits(chosenMask, problem.n);

  // Use CVaR-weighted expectation of the counterdiabatic samples (low-depth bias convergence)
  const evalEnergy = 0.5 * sample.expectationEnergy + 0.5 * sample.cvarEnergy;
  const approxRatio = computeApproxRatio(evalEnergy, spectrum.eMin, spectrum.eMax);

  return {
    algorithm: 'BF-DCQO',
    bits: chosenBits,
    achievedEnergy: spectrum.energies[chosenMask],
    expectationEnergy: evalEnergy,
    approxRatio,
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: depth,
    twoQubitGates,
    fidelityPct: Number(sample.effectiveFidelityPct.toFixed(1)),
    iterations: history.length,
    trajectoryRatios: resampleTrajectory(
      history.map((v) => computeApproxRatio(v, spectrum.eMin, spectrum.eMax)),
      15
    ),
    optimalBitstring: bitsToString(chosenBits),
    executionMode: 'exact_statevector',
    optimalParams: bestParams,
    sampleSummary: sample,
  };
}

/**
 * Hardware-Efficient VQA (RY + linear-chain CX ansatz).
 * Zero SWAP overhead on linear / Heavy-Hex chains.
 */
export function runExactVqaStatevector(params: {
  problem: FullQuboProblem;
  spectrum: ExactSpectrum;
  layersP: number;
  optimizer: ClassicalOptimizer;
  shots: number;
  hardware: HardwareCapabilities;
  seed: number;
}): RealSolverOutput {
  const t0 = nowMs();
  const { problem, spectrum, layersP, optimizer, shots, hardware, seed } = params;
  const p = Math.max(1, Math.min(4, layersP));
  const { depth, twoQubitGates } = computeGateCounts(problem.n, problem.edges.length, p, 1.0, 'VQA');
  const noise = makeNoiseParams(depth, twoQubitGates, hardware);
  const { circuitFidelity } = computeCircuitFidelity(noise, problem.n);

  const sv = allocateStatevector(problem.n);
  const n = problem.n;
  // Parameter vector: per-qubit RY angles on layer 0 + 2 shared layer angles for layers 1..p-1
  const paramCount = n + Math.max(0, p - 1) * 2;
  const initTheta = Array.from({ length: paramCount }, (_, i) =>
    i < n ? (problem.linear[i] < 0 ? 2.1 : 1.0) : 0.7
  );

  const prepareVqa = (theta: number[]) => {
    setZeroState(sv);
    const layerAngles = new Float64Array(n);
    for (let q = 0; q < n; q++) layerAngles[q] = theta[q];
    applyRYLayer(sv, layerAngles);
    applyCXLinearChain(sv);
    for (let l = 1; l < p; l++) {
      const aEven = theta[n + (l - 1) * 2];
      const aOdd = theta[n + (l - 1) * 2 + 1];
      for (let q = 0; q < n; q++) layerAngles[q] = q % 2 === 0 ? aEven : aOdd;
      applyRYLayer(sv, layerAngles);
      applyCXLinearChain(sv);
    }
  };

  const opt = optimizeClassical(
    (th) => {
      prepareVqa(th);
      return computeExactExpectation(sv, spectrum.energies, circuitFidelity, spectrum.meanEnergy);
    },
    initTheta,
    optimizer,
    Math.max(14, n * 2),
    seed + 307
  );

  prepareVqa(opt.bestParams);
  const sample = sampleStatevectorShots(sv, spectrum, shots, noise, seed + 311, 0.25);
  const chosenMask = sample.mostFrequentMask;
  const chosenBits = maskToBits(chosenMask, n);

  return {
    algorithm: 'VQA',
    bits: chosenBits,
    achievedEnergy: spectrum.energies[chosenMask],
    expectationEnergy: sample.expectationEnergy,
    approxRatio: computeApproxRatio(sample.expectationEnergy, spectrum.eMin, spectrum.eMax),
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: depth,
    twoQubitGates,
    fidelityPct: Number(sample.effectiveFidelityPct.toFixed(1)),
    iterations: opt.history.length,
    trajectoryRatios: resampleTrajectory(
      opt.history.map((v) => computeApproxRatio(v, spectrum.eMin, spectrum.eMax)),
      15
    ),
    optimalBitstring: bitsToString(chosenBits),
    executionMode: 'exact_statevector',
    sampleSummary: sample,
  };
}

/**
 * QITE: Exact Imaginary Time Evolution |ψ(τ)⟩ = exp(-τ H_C) |+⟩^⊗n / ||...||
 * Compiled with domain-truncated Pauli-block gate depth & hardware noise.
 */
export function runExactQiteStatevector(params: {
  problem: FullQuboProblem;
  spectrum: ExactSpectrum;
  ising: IsingHamiltonian;
  layersP: number;
  shots: number;
  hardware: HardwareCapabilities;
  swapMul: number;
  seed: number;
}): RealSolverOutput {
  const t0 = nowMs();
  const { problem, spectrum, ising, layersP, shots, hardware, swapMul, seed } = params;
  const steps = Math.max(6, Math.min(16, layersP * 4));
  const { depth, twoQubitGates } = computeGateCounts(problem.n, problem.edges.length, layersP, swapMul, 'QITE');
  const noise = makeNoiseParams(depth, twoQubitGates, hardware);
  const { circuitFidelity } = computeCircuitFidelity(noise, problem.n);

  const sv = allocateStatevector(problem.n);
  setPlusState(sv);

  const dTau = 0.55 / Math.max(0.5, ising.energyScale);
  const history: number[] = [
    computeExactExpectation(sv, spectrum.energies, circuitFidelity, spectrum.meanEnergy),
  ];

  for (let step = 1; step <= steps; step++) {
    let normSq = 0;
    for (let s = 0; s < sv.dim; s++) {
      // Shift by eMin for numerical stability: exp(-dTau * (E(s) - eMin))
      const factor = Math.exp(-dTau * (spectrum.energies[s] - spectrum.eMin));
      sv.re[s] *= factor;
      sv.im[s] *= factor;
      normSq += sv.re[s] * sv.re[s] + sv.im[s] * sv.im[s];
    }
    const invNorm = 1 / Math.sqrt(Math.max(1e-18, normSq));
    for (let s = 0; s < sv.dim; s++) {
      sv.re[s] *= invNorm;
      sv.im[s] *= invNorm;
    }
    history.push(computeExactExpectation(sv, spectrum.energies, circuitFidelity, spectrum.meanEnergy));
  }

  const sample = sampleStatevectorShots(sv, spectrum, shots, noise, seed + 409, 0.25);
  const chosenMask = sample.mostFrequentMask;
  const chosenBits = maskToBits(chosenMask, problem.n);

  return {
    algorithm: 'QITE',
    bits: chosenBits,
    achievedEnergy: spectrum.energies[chosenMask],
    expectationEnergy: sample.expectationEnergy,
    approxRatio: computeApproxRatio(sample.expectationEnergy, spectrum.eMin, spectrum.eMax),
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: depth,
    twoQubitGates,
    fidelityPct: Number(sample.effectiveFidelityPct.toFixed(1)),
    iterations: steps,
    trajectoryRatios: resampleTrajectory(
      history.map((v) => computeApproxRatio(v, spectrum.eMin, spectrum.eMax)),
      15
    ),
    optimalBitstring: bitsToString(chosenBits),
    executionMode: 'exact_statevector',
    sampleSummary: sample,
  };
}

/**
 * VarQITE: Variational Imaginary Time Evolution (McLachlan projection)
 * Evolves parameterized QAOA/RY-RZZ ansatz along natural imaginary-time gradient.
 */
export function runExactVarQiteStatevector(params: {
  problem: FullQuboProblem;
  spectrum: ExactSpectrum;
  ising: IsingHamiltonian;
  layersP: number;
  shots: number;
  hardware: HardwareCapabilities;
  swapMul: number;
  seed: number;
}): RealSolverOutput {
  const t0 = nowMs();
  const { problem, spectrum, ising, layersP, shots, hardware, swapMul, seed } = params;
  const p = Math.max(1, Math.min(4, layersP));
  const { depth, twoQubitGates } = computeGateCounts(problem.n, problem.edges.length, p, swapMul, 'VarQITE');
  const noise = makeNoiseParams(depth, twoQubitGates, hardware);
  const { circuitFidelity } = computeCircuitFidelity(noise, problem.n);

  const sv = allocateStatevector(problem.n);
  const scale = ising.energyScale;
  const n = problem.n;

  // Compact McLachlan variational ansatz: 2 grouped RY bias params + 2p cost/mixer params
  const theta = new Float64Array(2 + 2 * p);
  theta[0] = Math.PI / 2; // base superposition angle
  theta[1] = 0.25; // field-aligned bias tilt
  for (let l = 0; l < p; l++) {
    const frac = (l + 0.5) / p;
    theta[2 + l] = 0.45 + 1.15 * frac;
    theta[2 + p + l] = 0.68 * (1 - 0.62 * frac);
  }

  const ryAngles = new Float64Array(n);
  const prepareVar = (th: Float64Array) => {
    setZeroState(sv);
    for (let q = 0; q < n; q++) {
      ryAngles[q] = th[0] - th[1] * (ising.h[q] / Math.max(0.5, scale / Math.sqrt(n)));
    }
    applyRYLayer(sv, ryAngles);
    for (let l = 0; l < p; l++) {
      applyCostUnitary(sv, spectrum.energies, th[2 + l] / scale);
      applyXMixer(sv, th[2 + p + l]);
    }
  };

  const evalE = (th: Float64Array) => {
    prepareVar(th);
    return computeExactExpectation(sv, spectrum.energies, circuitFidelity, spectrum.meanEnergy);
  };

  const iters = 12;
  const eps = 0.08;
  const lr = 0.42 / Math.max(1.0, scale * 0.45);
  const history: number[] = [];
  let bestE = evalE(theta);
  let bestTheta = Float64Array.from(theta);
  history.push(bestE);

  for (let it = 0; it < iters; it++) {
    const grad = new Float64Array(theta.length);
    for (let k = 0; k < theta.length; k++) {
      const orig = theta[k];
      theta[k] = orig + eps;
      const fp = evalE(theta);
      theta[k] = orig - eps;
      const fm = evalE(theta);
      theta[k] = orig;
      grad[k] = (fp - fm) / (2 * eps);
    }
    for (let k = 0; k < theta.length; k++) {
      const step = (lr * grad[k]) / (1 + Math.abs(grad[k]) * 0.25);
      theta[k] -= Math.max(-0.35, Math.min(0.35, step));
    }
    const curE = evalE(theta);
    if (curE < bestE) {
      bestE = curE;
      bestTheta = Float64Array.from(theta);
    }
    history.push(bestE);
  }

  prepareVar(bestTheta);
  const sample = sampleStatevectorShots(sv, spectrum, shots, noise, seed + 503, 0.25);
  const chosenMask = sample.mostFrequentMask;
  const chosenBits = maskToBits(chosenMask, n);

  return {
    algorithm: 'VarQITE',
    bits: chosenBits,
    achievedEnergy: spectrum.energies[chosenMask],
    expectationEnergy: sample.expectationEnergy,
    approxRatio: computeApproxRatio(sample.expectationEnergy, spectrum.eMin, spectrum.eMax),
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: depth,
    twoQubitGates,
    fidelityPct: Number(sample.effectiveFidelityPct.toFixed(1)),
    iterations: iters,
    trajectoryRatios: resampleTrajectory(
      history.map((v) => computeApproxRatio(v, spectrum.eMin, spectrum.eMax)),
      15
    ),
    optimalBitstring: bitsToString(chosenBits),
    executionMode: 'exact_statevector',
    sampleSummary: sample,
  };
}

/**
 * QE-MCMC: Quantum-Enhanced Markov Chain Monte Carlo (Layden et al., Nature 2023).
 * Generates candidate proposals via real quantum evolution U(t) |x⟩ = exp(-i t (α H_C + (1-α) H_M)) |x⟩
 * and accepts/rejects with exact Metropolis-Hastings criterion.
 */
export function runExactQeMcmcStatevector(params: {
  problem: FullQuboProblem;
  spectrum: ExactSpectrum;
  ising: IsingHamiltonian;
  layersP: number;
  shots: number;
  hardware: HardwareCapabilities;
  swapMul: number;
  seed: number;
}): RealSolverOutput {
  const t0 = nowMs();
  const { problem, spectrum, ising, layersP, hardware, swapMul, seed } = params;
  const { depth, twoQubitGates } = computeGateCounts(problem.n, problem.edges.length, layersP, swapMul, 'QE-MCMC');
  const noise = makeNoiseParams(depth, twoQubitGates, hardware);
  const { circuitFidelity, effectiveFidelityPct } = computeCircuitFidelity(noise, problem.n);

  const rng = createSeededRng(seed + 601);
  const sv = allocateStatevector(problem.n);
  const scale = ising.energyScale;

  let currentMask = Math.floor(rng() * spectrum.dim);
  let currentE = spectrum.energies[currentMask];
  let bestMask = currentMask;
  let bestE = currentE;

  const steps = 24;
  const tStart = Math.max(0.5, (spectrum.eMax - spectrum.eMin) * 0.25);
  const tEnd = Math.max(0.04, (spectrum.eMax - spectrum.eMin) * 0.008);
  const history: number[] = [bestE];
  let eqSum = 0;
  let eqCount = 0;

  for (let step = 0; step < steps; step++) {
    const temp = tStart * Math.pow(tEnd / tStart, step / Math.max(1, steps - 1));
    const evoTime = 0.4 + rng() * 1.1;
    const trotter = Math.max(1, Math.min(3, layersP));
    const dt = evoTime / trotter;

    // Quantum proposal distribution starting from |currentMask⟩
    setBasisState(sv, currentMask);
    for (let tr = 0; tr < trotter; tr++) {
      applyCostUnitary(sv, spectrum.energies, (0.65 * dt) / scale);
      applyXMixer(sv, 0.55 * dt);
    }

    // Draw one proposal bitstring from noisy proposal probabilities
    const u = rng();
    const uniformShare = (1 - circuitFidelity) / spectrum.dim;
    let accum = 0;
    let proposalMask = spectrum.dim - 1;
    for (let s = 0; s < spectrum.dim; s++) {
      accum += circuitFidelity * (sv.re[s] * sv.re[s] + sv.im[s] * sv.im[s]) + uniformShare;
      if (accum >= u) {
        proposalMask = s;
        break;
      }
    }
    if (noise.enableNoise && noise.readoutErrorRate > 0) {
      for (let q = 0; q < problem.n; q++) {
        if (rng() < noise.readoutErrorRate) proposalMask ^= 1 << q;
      }
    }

    const propE = spectrum.energies[proposalMask];
    const dE = propE - currentE;
    if (dE <= 0 || rng() < Math.exp(-dE / Math.max(1e-6, temp))) {
      currentMask = proposalMask;
      currentE = propE;
    }
    if (currentE < bestE) {
      bestE = currentE;
      bestMask = currentMask;
    }
    if (step >= Math.floor(steps * 0.5)) {
      eqSum += currentE;
      eqCount++;
    }
    history.push(bestE);
  }

  const eqMeanEnergy = eqCount > 0 ? eqSum / eqCount : bestE;
  const chosenBits = maskToBits(bestMask, problem.n);

  return {
    algorithm: 'QE-MCMC',
    bits: chosenBits,
    achievedEnergy: bestE,
    expectationEnergy: eqMeanEnergy,
    approxRatio: computeApproxRatio(eqMeanEnergy, spectrum.eMin, spectrum.eMax),
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: depth,
    twoQubitGates,
    fidelityPct: Number(effectiveFidelityPct.toFixed(1)),
    iterations: steps,
    trajectoryRatios: resampleTrajectory(
      history.map((v) => computeApproxRatio(v, spectrum.eMin, spectrum.eMax)),
      15
    ),
    optimalBitstring: bitsToString(chosenBits),
    executionMode: 'exact_statevector',
  };
}

/**
 * GAS: Grover Adaptive Search (Gilliam et al., Quantum 2021).
 * Applies exact phase-flip threshold oracle O_y |x⟩ = (-1)^{[E(x) < y]} |x⟩
 * and exact Grover diffusion D = 2|+⟩⟨+| - I on the 2^n statevector.
 */
export function runExactGasStatevector(params: {
  problem: FullQuboProblem;
  spectrum: ExactSpectrum;
  layersP: number;
  shots: number;
  hardware: HardwareCapabilities;
  swapMul: number;
  seed: number;
}): RealSolverOutput {
  const t0 = nowMs();
  const { problem, spectrum, layersP, shots, hardware, swapMul, seed } = params;
  const { depth, twoQubitGates } = computeGateCounts(problem.n, problem.edges.length, layersP, swapMul, 'GAS');
  const noise = makeNoiseParams(depth, twoQubitGates, hardware);
  const rng = createSeededRng(seed + 701);

  const sv = allocateStatevector(problem.n);
  let thresholdMask = Math.floor(rng() * spectrum.dim);
  let threshold = spectrum.energies[thresholdMask];
  const history: number[] = [threshold];

  const rounds = 10;
  let groverSchedule = 1;
  let lastSample: ShotSampleSummary | undefined;

  for (let r = 0; r < rounds; r++) {
    setPlusState(sv);
    const kIters = Math.min(Math.max(1, groverSchedule), Math.max(2, Math.floor(Math.sqrt(spectrum.dim) * 0.55)));

    for (let g = 0; g < kIters; g++) {
      // Exact phase-flip oracle: flip sign of all states with E(s) < threshold
      for (let s = 0; s < sv.dim; s++) {
        if (spectrum.energies[s] < threshold - 1e-9) {
          sv.re[s] = -sv.re[s];
          sv.im[s] = -sv.im[s];
        }
      }
      // Exact Grover diffusion: reflection about |+⟩^⊗n -> a_s' = 2*mean(a) - a_s
      let meanRe = 0;
      let meanIm = 0;
      for (let s = 0; s < sv.dim; s++) {
        meanRe += sv.re[s];
        meanIm += sv.im[s];
      }
      meanRe /= sv.dim;
      meanIm /= sv.dim;
      for (let s = 0; s < sv.dim; s++) {
        sv.re[s] = 2 * meanRe - sv.re[s];
        sv.im[s] = 2 * meanIm - sv.im[s];
      }
    }

    const roundSample = sampleStatevectorShots(
      sv,
      spectrum,
      Math.max(128, Math.floor(shots / rounds)),
      noise,
      seed + 710 + r * 19,
      0.25
    );
    lastSample = roundSample;
    const candidateMask = roundSample.mostFrequentMask;
    const candidateE = spectrum.energies[candidateMask];
    if (candidateE < threshold - 1e-9) {
      threshold = candidateE;
      thresholdMask = candidateMask;
      groverSchedule = 1;
    } else {
      groverSchedule = Math.min(8, Math.ceil(groverSchedule * 1.35));
    }
    history.push(threshold);
  }

  // Final amplified measurement distribution around the discovered threshold
  const finalSample =
    lastSample ?? sampleStatevectorShots(sv, spectrum, shots, noise, seed + 799, 0.25);
  const chosenBits = maskToBits(thresholdMask, problem.n);
  // GAS quality reflects both its discovered threshold and final amplified shot expectation under QPU noise
  const effectiveEnergy =
    noise.enableNoise && finalSample.circuitFidelity < 0.92
      ? 0.45 * threshold + 0.55 * finalSample.expectationEnergy
      : threshold;

  return {
    algorithm: 'GAS',
    bits: chosenBits,
    achievedEnergy: threshold,
    expectationEnergy: effectiveEnergy,
    approxRatio: computeApproxRatio(effectiveEnergy, spectrum.eMin, spectrum.eMax),
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: depth,
    twoQubitGates,
    fidelityPct: Number(finalSample.effectiveFidelityPct.toFixed(1)),
    iterations: rounds,
    trajectoryRatios: resampleTrajectory(
      history.map((v) => computeApproxRatio(v, spectrum.eMin, spectrum.eMax)),
      15
    ),
    optimalBitstring: bitsToString(chosenBits),
    executionMode: 'exact_statevector',
    sampleSummary: finalSample,
  };
}

// -----------------------------------------------------------------------------
// Full-Scale Ising Machine & Classical Baselines (Work Natively for 6..50 Nodes)
// -----------------------------------------------------------------------------

/**
 * Ballistic Simulated Bifurcation (bSB) Ising Machine (Goto et al., Sci. Adv. 2021).
 * Integrates coupled Kerr-nonlinear oscillator equations directly on H_C(h, J).
 */
export function runIsingMachineBsb(
  problem: FullQuboProblem,
  ising: IsingHamiltonian,
  eMinRef: number,
  eMaxRef: number,
  seed: number
): RealSolverOutput {
  const t0 = nowMs();
  const n = problem.n;
  const rng = createSeededRng(seed + 809);

  const a0 = 1.0;
  const dt = 0.45;
  const steps = 60;
  const restarts = 8;
  const c0 = 0.5 / Math.max(0.5, ising.energyScale * Math.sqrt(Math.max(1, n / 4)));

  let bestBits = new Uint8Array(n);
  let bestE = Infinity;
  const history: number[] = [];

  for (let r = 0; r < restarts; r++) {
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = (rng() - 0.5) * 0.12;
      y[i] = (rng() - 0.5) * 0.12;
    }

    for (let s = 0; s < steps; s++) {
      const a = (a0 * s) / steps;
      // Compute Ising local forces: -(h_i + sum_j J_ij * sgn(x_j))
      for (let i = 0; i < n; i++) {
        let coupling = ising.h[i];
        const neighbors = problem.adj[i];
        for (let k = 0; k < neighbors.length; k++) {
          const nb = neighbors[k];
          const sj = x[nb.neighbor] >= 0 ? 1 : -1;
          coupling += 0.25 * nb.qij * sj;
        }
        // Symplectic Euler update with walls |x_i| <= 1
        y[i] += (-(a0 - a) * x[i] - c0 * coupling) * dt;
        x[i] += a0 * y[i] * dt;
        if (x[i] > 1) {
          x[i] = 1;
          y[i] = 0;
        } else if (x[i] < -1) {
          x[i] = -1;
          y[i] = 0;
        }
      }
      if (r === 0 && s % 4 === 0) {
        const snapBits = new Uint8Array(n);
        for (let i = 0; i < n; i++) snapBits[i] = x[i] < 0 ? 1 : 0;
        const snapE = evaluateQuboBits(problem, snapBits);
        if (snapE < bestE) {
          bestE = snapE;
          bestBits = snapBits;
        }
        history.push(bestE);
      }
    }

    const candBits = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // z_i = +1 -> x_i = 0; z_i = -1 -> x_i = 1
      candBits[i] = x[i] < 0 ? 1 : 0;
    }
    const candE = evaluateQuboBits(problem, candBits);
    if (candE < bestE) {
      bestE = candE;
      bestBits = candBits;
    }
    history.push(bestE);
  }

  return {
    algorithm: 'Ising Machine',
    bits: bestBits,
    achievedEnergy: bestE,
    expectationEnergy: bestE,
    approxRatio: computeApproxRatio(bestE, eMinRef, eMaxRef),
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: 0,
    twoQubitGates: 0,
    fidelityPct: 100.0,
    iterations: restarts * steps,
    trajectoryRatios: resampleTrajectory(
      history.map((v) => computeApproxRatio(v, eMinRef, eMaxRef)),
      15
    ),
    optimalBitstring: bitsToString(bestBits),
    executionMode: 'ising_dynamics',
  };
}

/**
 * Real Classical Metropolis-Hastings Simulated Annealing on exact full QUBO.
 */
export function runSimulatedAnnealing(
  problem: FullQuboProblem,
  eMinRef: number,
  eMaxRef: number,
  seed: number,
  restarts = 4,
  sweepsPerRestart = 22
): RealSolverOutput {
  const t0 = nowMs();
  const n = problem.n;
  const rng = createSeededRng(seed + 907);

  const scale = Math.max(1.0, (eMaxRef - eMinRef) * 0.25);
  const t0Temp = scale * 1.1;
  const tEndTemp = scale * 0.015;

  let bestBits = new Uint8Array(n);
  let bestE = evaluateQuboBits(problem, bestBits);
  const history: number[] = [bestE];

  const totalSteps = restarts * sweepsPerRestart * n;
  const sampleStride = Math.max(1, Math.floor(totalSteps / 24));
  let stepCounter = 0;

  for (let r = 0; r < restarts; r++) {
    const bits = new Uint8Array(n);
    for (let i = 0; i < n; i++) bits[i] = rng() < 0.5 ? 1 : 0;
    let curE = evaluateQuboBits(problem, bits);
    if (curE < bestE) {
      bestE = curE;
      bestBits = Uint8Array.from(bits);
    }

    for (let sw = 0; sw < sweepsPerRestart; sw++) {
      const frac = sw / Math.max(1, sweepsPerRestart - 1);
      const temp = t0Temp * Math.pow(tEndTemp / t0Temp, frac);
      for (let i = 0; i < n; i++) {
        const idx = Math.floor(rng() * n);
        const dE = deltaEnergyFlip(problem, bits, idx);
        if (dE <= 0 || rng() < Math.exp(-dE / Math.max(1e-6, temp))) {
          bits[idx] ^= 1;
          curE += dE;
          if (curE < bestE) {
            bestE = curE;
            bestBits = Uint8Array.from(bits);
          }
        }
        stepCounter++;
        if (stepCounter % sampleStride === 0) {
          history.push(bestE);
        }
      }
    }
  }
  history.push(bestE);

  return {
    algorithm: 'Simulated Annealing',
    bits: bestBits,
    achievedEnergy: bestE,
    expectationEnergy: bestE,
    approxRatio: computeApproxRatio(bestE, eMinRef, eMaxRef),
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: 0,
    twoQubitGates: 0,
    fidelityPct: 100.0,
    iterations: restarts * sweepsPerRestart,
    trajectoryRatios: resampleTrajectory(
      history.map((v) => computeApproxRatio(v, eMinRef, eMaxRef)),
      15
    ),
    optimalBitstring: bitsToString(bestBits),
    executionMode: 'classical_qubo',
  };
}

/**
 * Real Classical Myopic Greedy Dispatch on exact full QUBO.
 * Commits nodes strictly in descending order of individual linear priority (-Q_ii)
 * whenever the immediate marginal energy change ΔE_i < 0 (no backtracking).
 */
export function runGreedyDispatch(
  problem: FullQuboProblem,
  eMinRef: number,
  eMaxRef: number
): RealSolverOutput {
  const t0 = nowMs();
  const n = problem.n;
  const bits = new Uint8Array(n);

  // Myopic feeder order: rank nodes solely by standalone diagonal benefit Q_ii
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => problem.linear[a] - problem.linear[b]
  );

  let energy = 0;
  for (const idx of order) {
    const dE = deltaEnergyFlip(problem, bits, idx);
    if (dE < 0) {
      bits[idx] = 1;
      energy += dE;
    }
  }

  const ratio = computeApproxRatio(energy, eMinRef, eMaxRef);
  return {
    algorithm: 'Greedy Dispatch',
    bits,
    achievedEnergy: energy,
    expectationEnergy: energy,
    approxRatio: ratio,
    runtimeMs: Math.max(0.1, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: 0,
    twoQubitGates: 0,
    fidelityPct: 100.0,
    iterations: 1,
    trajectoryRatios: Array(15).fill(ratio),
    optimalBitstring: bitsToString(bits),
    executionMode: 'classical_qubo',
  };
}

/**
 * Real QUBO Partitioned Statevector Solver for N = 13..50 nodes.
 * Decomposes the N-node QUBO into blocks of size <= blockSize (default 8 qubits)
 * and runs exact 2^k statevector optimization on each block with boundary-clamped
 * effective linear fields Q'_ii = Q_ii + sum_{j not in B} Q_ij x_j across 2 sweeps.
 */
export function runPartitionedQuantumSolver(params: {
  problem: FullQuboProblem;
  algorithm: QuantumAlgorithm;
  layersP: number;
  optimizer: ClassicalOptimizer;
  shots: number;
  hardware: HardwareCapabilities;
  swapMul: number;
  eMinRef: number;
  eMaxRef: number;
  seed: number;
}): RealSolverOutput {
  const t0 = nowMs();
  const { problem, algorithm, layersP, optimizer, shots, hardware, swapMul, eMinRef, eMaxRef, seed } = params;
  const n = problem.n;
  const blockSize = Math.max(6, Math.min(8, hardware.maxQubits));

  // Start from Greedy seed for warm boundary clamping
  const globalBits = runGreedyDispatch(problem, eMinRef, eMaxRef).bits;
  const history: number[] = [evaluateQuboBits(problem, globalBits)];

  let maxDepth = 0;
  let totalTwoQ = 0;
  let fidelityAccum = 0;
  let blockCount = 0;
  let totalIters = 0;

  for (let sweep = 0; sweep < 2; sweep++) {
    for (let start = 0; start < n; start += blockSize) {
      const end = Math.min(n, start + blockSize);
      const k = end - start;
      if (k < 2) continue;

      // Build induced sub-QUBO with boundary-clamped linear fields
      const subLinear: number[] = Array(k).fill(0);
      const subEdges: { i: number; j: number; qij: number }[] = [];

      for (let localI = 0; localI < k; localI++) {
        const gi = start + localI;
        let qii = problem.linear[gi];
        for (const nb of problem.adj[gi]) {
          if (nb.neighbor < start || nb.neighbor >= end) {
            if (globalBits[nb.neighbor]) qii += nb.qij;
          } else if (nb.neighbor > gi) {
            subEdges.push({ i: localI, j: nb.neighbor - start, qij: nb.qij });
          }
        }
        subLinear[localI] = qii;
      }

      const subProblem = buildFullQuboProblem(k, subLinear, subEdges);
      const subSpectrum = computeExactSpectrum(subProblem);
      const subIsing = quboToIsing(subProblem);
      const subSeed = seed + sweep * 500 + start * 17;

      const subRes = runSingleExactQuantumSolver({
        algorithm,
        problem: subProblem,
        spectrum: subSpectrum,
        ising: subIsing,
        layersP,
        optimizer,
        shots: Math.max(512, Math.floor(shots / Math.ceil(n / blockSize))),
        hardware,
        swapMul,
        seed: subSeed,
      });

      // Accept block update if it improves or matches full-graph energy
      const candidate = Uint8Array.from(globalBits);
      for (let localI = 0; localI < k; localI++) {
        candidate[start + localI] = subRes.bits[localI];
      }
      const prevE = evaluateQuboBits(problem, globalBits);
      const candE = evaluateQuboBits(problem, candidate);
      if (candE <= prevE + 1e-9 || sweep === 0) {
        globalBits.set(candidate);
      }

      maxDepth = Math.max(maxDepth, subRes.circuitDepth);
      totalTwoQ += subRes.twoQubitGates;
      fidelityAccum += subRes.fidelityPct;
      blockCount++;
      totalIters += subRes.iterations;
      history.push(evaluateQuboBits(problem, globalBits));
    }
  }

  const finalEnergy = evaluateQuboBits(problem, globalBits);
  const avgFidelity = blockCount > 0 ? fidelityAccum / blockCount : 95.0;
  // Reflect hardware noise on expected quality of partitioned execution
  const expectedRatioFromBits = computeApproxRatio(finalEnergy, eMinRef, eMaxRef);
  const noiseDampedRatio =
    hardware.backendId.includes('aer_simulator') && hardware.twoQubitErrorRate <= 0.0005
      ? expectedRatioFromBits
      : Math.max(0.1, expectedRatioFromBits * (0.45 + 0.55 * (avgFidelity / 100)));

  return {
    algorithm,
    bits: globalBits,
    achievedEnergy: finalEnergy,
    expectationEnergy: eMaxRef - noiseDampedRatio * (eMaxRef - eMinRef),
    approxRatio: noiseDampedRatio,
    runtimeMs: Math.max(0.2, Number((nowMs() - t0).toFixed(1))),
    circuitDepth: maxDepth,
    twoQubitGates: totalTwoQ,
    fidelityPct: Number(avgFidelity.toFixed(1)),
    iterations: totalIters,
    trajectoryRatios: resampleTrajectory(
      history.map((e) => computeApproxRatio(e, eMinRef, eMaxRef)),
      15
    ),
    optimalBitstring: bitsToString(globalBits),
    executionMode: 'partitioned_statevector',
  };
}

export function runSingleExactQuantumSolver(params: {
  algorithm: QuantumAlgorithm;
  problem: FullQuboProblem;
  spectrum: ExactSpectrum;
  ising: IsingHamiltonian;
  layersP: number;
  optimizer: ClassicalOptimizer;
  shots: number;
  hardware: HardwareCapabilities;
  swapMul: number;
  seed: number;
}): RealSolverOutput {
  const { algorithm, problem, spectrum, ising, layersP, optimizer, shots, hardware, swapMul, seed } = params;
  switch (algorithm) {
    case 'CVaR-QAOA':
      return runExactQaoaStatevector({
        problem,
        spectrum,
        ising,
        layersP,
        optimizer,
        shots,
        hardware,
        swapMul,
        isCvar: true,
        seed,
      });
    case 'BF-DCQO':
      return runExactBfDcqoStatevector({
        problem,
        spectrum,
        ising,
        layersP,
        optimizer,
        shots,
        hardware,
        swapMul,
        seed,
      });
    case 'VQA':
    case 'VQE':
      return runExactVqaStatevector({
        problem,
        spectrum,
        layersP,
        optimizer,
        shots,
        hardware,
        seed,
      });
    case 'QITE':
      return runExactQiteStatevector({
        problem,
        spectrum,
        ising,
        layersP,
        shots,
        hardware,
        swapMul,
        seed,
      });
    case 'VarQITE':
      return runExactVarQiteStatevector({
        problem,
        spectrum,
        ising,
        layersP,
        shots,
        hardware,
        swapMul,
        seed,
      });
    case 'QE-MCMC':
    case 'Quantum Kernel SVM':
      return runExactQeMcmcStatevector({
        problem,
        spectrum,
        ising,
        layersP,
        shots,
        hardware,
        swapMul,
        seed,
      });
    case 'GAS':
    case 'Grover-Adaptive':
      return runExactGasStatevector({
        problem,
        spectrum,
        layersP,
        shots,
        hardware,
        swapMul,
        seed,
      });
    case 'Ising Machine':
      return runIsingMachineBsb(problem, ising, spectrum.eMin, spectrum.eMax, seed);
    case 'QAOA':
    default:
      return runExactQaoaStatevector({
        problem,
        spectrum,
        ising,
        layersP,
        optimizer,
        shots,
        hardware,
        swapMul,
        isCvar: false,
        seed,
      });
  }
}
