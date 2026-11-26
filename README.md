# Digital Q-Grid Twin — Quantum Microgrid Load Balancing & IBM Qiskit Lab

**Digital Q-Grid Twin** is a full-stack quantum-assisted rural microgrid load-balancing digital twin and live **IBM Quantum Platform (SamplerV2)** execution studio built with React, TypeScript, Vite, Tailwind CSS, Three.js, D3, and Express.

It formulates **6–12 node rural microgrid dispatch max of 50 nodes** (solar, wind, battery, and feeder constraints) as a **QUBO**, maps it exactly to an **Ising Hamiltonian**, benchmarks **9 quantum/Ising solvers against Greedy and Simulated Annealing**, and executes **OpenQASM 3.0 ISA circuits** on real IBM Quantum Heron r2 QPUs (`ibm_fez`, `ibm_kingston`, `ibm_marrakesh`).

---

## Architecture & Data Flow

The application separates live external weather inputs, configurable microgrid topology, surrogate electrical modeling, and exact quantum optimization into four explicit layers:

```text
[1. Real Live Weather]        Open-Meteo 15-min API (solar W/m², 80m wind m/s, temp °C, local timezone)
          │
          ▼
[2. Microgrid Topology]       Configured regional benchmarks (src/constants/regions.ts)
          │                   OR user-uploaded CSV / JSON / multi-sheet Excel (.xlsx) datasets
          ▼
[3. Electrical Surrogate]     Lightweight linearized voltage sag, conductor heating,
          │                   weather-based line derating & quadratic I²R losses (src/data/liveRegions.ts)
          ▼
[4. Optimization & QPU]       Soft-penalty QUBO C(x) = Σ Q_ii x_i + Σ Q_ij x_i x_j
                              ──► Exact QUBO → Ising mapping (H_C = Σ h_i Z_i + Σ J_ij Z_i Z_j)
                              ──► Exact 2^N ground-state verification (N ≤ 12)
                              ──► 9 Quantum/Ising solvers + Greedy & Simulated Annealing
                              ──► Real IBM Quantum SamplerV2 Multi-PUB ISA execution (ibm_fez, etc.)
                              ──► Operational KPIs: % Demand Met, Cost Saved ($/day), Line Loss
```

### Technical Scope & Honesty Note
- **Real external data:** Live 15-minute Open-Meteo solar irradiance, 80 m wind speed, ambient temperature, and local IANA timezone (`Asia/Kolkata`, `America/Chicago`, etc.) locked to the region's current local clock (`Live Now`).
- **Configured grid specs:** Representative bus capacities, base loads, resistances, and thermal limits in `src/constants/regions.ts` (replaceable via CSV/JSON/Excel upload in **Explore & Qiskit Lab**).
- **Surrogate electrical/thermal model:** Linearized voltage drop, conductor heating, linear weather derating, and quadratic $I^2R$ loss approximations—not a full Newton–Raphson AC-OPF or full IEEE-738 solver.
- **Exact optimization & real hardware:** Exact QUBO-to-Ising transformation, exact $2^N$ statevector simulation and ground-state benchmarking for $N \le 12$, plus real IBM Quantum Platform REST v1 **SamplerV2** (`version: 2`) hardware execution with live `basis_gates`/`coupling_map` ISA transpilation (`rz`, `sx`, `cz`, physical qubits `$p`, BFS SWAP routing).

---

## How the App Works (User Flow)

1. **Overview (`Live grid & alerts`)**
   - Opens locked to the selected region's real local time (default: **Rural Karnataka Microgrid (8 Nodes) — India**, `Asia/Kolkata`, `Live Now`) with live Open-Meteo weather.
   - Use **Replay 24h Forecast** or drag the 15-minute timeline slider to inspect diurnal solar/wind swings, and click **Jump to Now** to snap back to live local time.
   - Explore the **3D Geo Map** (Three.js) or **2D D3** network view, toggle **Quantum Path / Classical Path / Q vs C Diff**, trigger **Inject Grid Fault**, and run **Run Quantum Optimization**.
2. **Node Diagnostics (`Per-node telemetry`)**
   - Inspect per-bus load/capacity, surrogate voltage, conductor thermal margin, GPS coordinates, and solar/wind readings; adjust node stress and trigger single-node rerouting.
3. **Quantum Kernels & QA (`Circuits & benchmarks`)**
   - Inspect the constructed **QUBO matrix ($Q$)** and **Ising Hamiltonian ($H_C, H_M$)**, sweep **QAOA depth $p$**, visualize classical optimizer convergence ($\gamma, \beta$), and analyze **Convergence vs. Graph Density**.
4. **Explore & Qiskit Lab (`Upload & test datasets`)**
   - Generate custom **6–50 node** rural microgrids with controllable graph density or upload your own **CSV, JSON, or multi-sheet `.xlsx`** dataset (templates downloadable directly in-app).
   - Toggle QUBO penalty constraints (`Thermal Limits`, `Voltage ±5%`, `N-1 Contingency`, `Renewable Ramp`, `Substation Cap`).
   - Run **All 9 Solvers + Baselines** (`QAOA`, `CVaR-QAOA`, `BF-DCQO`, `VQA`, `VarQITE`, `QE-MCMC`, `Simulated Bifurcation`, `QAOA-WarmStart`, `Quantum Annealing`, plus `Greedy` and `Simulated Annealing`).
   - Under **Real IBM Qiskit Job Execution**, pick a live online IBM QPU (`ibm_fez`, `ibm_kingston`, `ibm_marrakesh`) and click **Run All 5 Gate Solvers on `<backend>`** to submit `QAOA`, `CVaR-QAOA`, `BF-DCQO`, `VQA`, and `VarQITE` together as a single **Multi-PUB SamplerV2** hardware job. Inspect each submitted **OpenQASM 3.0 ISA** circuit and watch completed hardware measurements overlay onto the benchmark table with an `IBM QPU` badge.
5. **Impact & Constraints (`Accuracy over time`)**
   - Review deployment economics (**% Demand Met**, **Daily Cost Saved**, outage avoidance, and constraint sensitivity).

---

## Prerequisites

- **Node.js 20+** (tested on Node v22) **or Bun 1.1+**
- Optional (for real IBM Quantum hardware execution): an **IBM Cloud API Key** and **IBM Quantum Runtime Service Instance CRN** from [IBM Quantum Platform](https://quantum.cloud.ibm.com/).

---

## Environment Setup (`.env`)

1. Copy `.env.example` to `.env` in the project root (`.env` is gitignored):

```bash
cp .env.example .env
```

2. Edit `.env` with your credentials:

```env
# Required only for real IBM Quantum hardware execution (server-side only; never use VITE_ prefix)
IBM_QUANTUM_TOKEN=your_ibm_cloud_api_key
IBM_QUANTUM_INSTANCE=crn:v1:bluemix:public:quantum-computing:us-east:a/...
IBM_QUANTUM_REGION=us-east

# Optional: external Python FastAPI Qiskit microservice (see qiskit_service/)
QISKIT_SERVICE_URL=

# Leave blank when using IBM Cloud REST directly
QISKIT_PYTHON_BIN=
```

> **Note:** Never commit `.env` to git. If you leave `IBM_QUANTUM_TOKEN` blank, the full dashboard, Open-Meteo live weather, exact $2^N$ statevector simulator, and all 9 local solvers + classical baselines still work immediately.

---

## Installation & Running Locally

### Using npm
```bash
rm -rf node_modules bun.lock package-lock.json
npm install
npm run dev
```

### Using Bun
```bash
rm -rf node_modules bun.lock
bun install
bun run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

### If Port `3000` Is Already in Use (macOS / Linux)
```bash
lsof -ti:3000,24678 | xargs kill -9
npm run dev
```

### Optional: Python Qiskit FastAPI Microservice
If you also want to run local Python `qiskit-aer` alongside IBM Cloud REST:

```bash
cd qiskit_service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 127.0.0.1 --port 8000
```

Then set `QISKIT_SERVICE_URL=http://127.0.0.1:8000` in `.env` and restart `npm run dev`.

---

## Verification, Tests & Production Build

```bash
# Type-check TypeScript
npm run lint

# Run all unit tests (QUBO-to-Ising, statevector unitaries, Open-Meteo timezone, dataset parser, IBM ISA transpiler & Multi-PUB BitArray decoder)
npx --yes tsx --test \
  src/data/liveRegions.test.ts \
  src/engine/quantumGridEngine.test.ts \
  src/engine/quboSolverEngine.test.ts \
  src/engine/datasetParser.test.ts \
  server/qiskitExecutor.test.ts

# Production frontend bundle
npm run build
```

---

## Backend API Endpoints (`server.ts`)

| Method | Endpoint | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/status` | Server health and active job status |
| `GET` | `/api/live-grid/regions` | Available live regional microgrid definitions |
| `GET` | `/api/live-grid/stream?regionId=<id>` | Fetches & caches 15-min Open-Meteo weather with region-local `currentSlotIndex` |
| `POST` | `/api/optimize-grid` | Runs quantum optimization on the active grid topology |
| `POST` | `/api/optimize` | Runs single quantum vs. classical benchmark comparison |
| `POST` | `/api/qubo-suite` | Runs all 9 quantum/Ising solvers + Greedy & Simulated Annealing |
| `GET` | `/api/qiskit/status` | Reports active Qiskit execution mode and live online IBM QPUs |
| `POST` | `/api/qiskit/execute` | Transpiles & submits a single SamplerV2 ISA OpenQASM 3.0 job to IBM Quantum |
| `POST` | `/api/qiskit/execute-batch` | Submits all 5 gate solvers (`QAOA`, `CVaR-QAOA`, `BF-DCQO`, `VQA`, `VarQITE`) as 1 Multi-PUB SamplerV2 job |
| `GET` | `/api/qiskit/jobs/:jobId` | Polls IBM Quantum job status, decodes `BitArray` counts, and scores microgrid KPIs |

---

## Project Structure

```text
├── server.ts                      # Express API + Vite dev middleware (port 3000)
├── server/
│   ├── qiskitExecutor.ts          # IBM Quantum REST v1 SamplerV2 client, Heron ISA transpiler & BitArray decoder
│   ├── qiskitExecutor.test.ts     # ISA transpiler & Multi-PUB BitArray unit tests
│   └── algorithmTemplate.ts       # Custom quantum solver template runner
├── qiskit_service/                # Optional Python FastAPI Qiskit / Aer microservice
├── src/
│   ├── App.tsx                    # Main 5-view dashboard shell & state orchestration
│   ├── constants/                 # Regional specs (Karnataka, Texas, California, Bavaria, Kyushu), hardware profiles
│   ├── data/liveRegions.ts        # Open-Meteo 15-min client, timezone slot lock & electrical/thermal surrogate
│   ├── engine/
│   │   ├── quboSolverEngine.ts    # Microgrid QUBO builder, bitstring KPI evaluator & 9-solver suite
│   │   ├── realQuantumSolvers.ts  # Exact QUBO→Ising, 2^N statevector QAOA/CVaR-QAOA/BF-DCQO/VQA/VarQITE, Greedy & SA
│   │   ├── quantumGridEngine.ts   # Grid summaries, fault injection & node rerouting
│   │   └── datasetParser.ts       # CSV / JSON / multi-sheet Excel (.xlsx) parser & template builder
│   ├── views/                     # OverviewView, NodeDiagnosticsView, QuantumKernelsView, ExploreLabView, ImpactView
│   └── components/                # ThreeGridVisualizer (3D), D3GridVisualizer (2D), Sidebar, Header
├── .env.example                   # Environment variable template (no secrets)
└── package.json
```
