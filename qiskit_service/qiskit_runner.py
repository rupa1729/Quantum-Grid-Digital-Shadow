#!/usr/bin/env python3
"""
Real IBM Qiskit microgrid QUBO/Ising executor.
Executes genuine Qiskit QuantumCircuits on either:
  1. qiskit_aer.AerSimulator (real Qiskit local simulator), OR
  2. qiskit_ibm_runtime.QiskitRuntimeService + SamplerV2 (real IBM Quantum QPU).

Invocation (stdin -> stdout JSON):
  python3 qiskit_service/qiskit_runner.py < payload.json
  python3 qiskit_service/qiskit_runner.py --probe
"""

from __future__ import annotations

import json
import os
import sys
import time
from typing import Any, Dict, List, Tuple


def probe_environment() -> Dict[str, Any]:
    qiskit_version = None
    aer_available = False
    ibm_runtime_available = False

    try:
        import qiskit  # type: ignore

        qiskit_version = getattr(qiskit, "__version__", "unknown")
    except Exception:
        pass

    try:
        import qiskit_aer  # type: ignore  # noqa: F401

        aer_available = True
    except Exception:
        pass

    try:
        import qiskit_ibm_runtime  # type: ignore  # noqa: F401

        ibm_runtime_available = True
    except Exception:
        pass

    return {
        "qiskit_available": qiskit_version is not None,
        "qiskit_version": qiskit_version,
        "aer_available": aer_available,
        "ibm_runtime_available": ibm_runtime_available,
    }


def eval_qubo_bitstring(
    bitstring_q0_left: str,
    linear: List[float],
    edges: List[Dict[str, Any]],
) -> float:
    bits = [1 if ch == "1" else 0 for ch in bitstring_q0_left]
    energy = 0.0
    for i, qii in enumerate(linear):
        if i < len(bits) and bits[i]:
            energy += float(qii)
    for edge in edges:
        i = int(edge["i"])
        j = int(edge["j"])
        if i < len(bits) and j < len(bits) and bits[i] and bits[j]:
            energy += float(edge["qij"])
    return energy


def build_ansatz_circuit(
    n_qubits: int,
    h_fields: List[float],
    j_edges: List[Dict[str, Any]],
    layers_p: int,
    algorithm: str,
    params: List[float],
    energy_scale: float,
):
    from qiskit import QuantumCircuit  # type: ignore

    qc = QuantumCircuit(n_qubits, n_qubits)
    qc.h(range(n_qubits))
    scale = max(1e-6, float(energy_scale))

    if algorithm == "VQA":
        idx = 0
        for _ in range(layers_p):
            for q in range(n_qubits):
                theta = float(params[idx % len(params)])
                qc.ry(theta, q)
                idx += 1
            for q in range(n_qubits - 1):
                qc.cx(q, q + 1)
    else:
        for layer in range(layers_p):
            gamma = float(params[2 * layer])
            beta = float(params[2 * layer + 1])

            for i in range(n_qubits):
                hi = float(h_fields[i]) / scale
                if abs(hi) > 1e-9:
                    qc.rz(2.0 * gamma * hi, i)

            for edge in j_edges:
                u = int(edge["i"])
                v = int(edge["j"])
                juv = float(edge["Jij"]) / scale
                if u < n_qubits and v < n_qubits and abs(juv) > 1e-9:
                    qc.rzz(2.0 * gamma * juv, u, v)

            if algorithm == "BF-DCQO":
                for i in range(n_qubits):
                    qc.rx(2.0 * beta, i)
                    qc.ry(-0.35 * gamma * (float(h_fields[i]) / scale), i)
            else:
                for i in range(n_qubits):
                    qc.rx(2.0 * beta, i)

    qc.measure(range(n_qubits), range(n_qubits))
    return qc


def extract_counts_from_pub_result(pub_result: Any) -> Dict[str, int]:
    # SamplerV2 returns BitArray under classical register (usually "c" or "meas")
    data = pub_result.data
    for attr in ("c", "meas"):
        if hasattr(data, attr):
            return getattr(data, attr).get_counts()
    for field in data:
        val = getattr(data, field)
        if hasattr(val, "get_counts"):
            return val.get_counts()
    raise RuntimeError("Unable to extract bitstring counts from Qiskit SamplerV2 result.")


def execute_qiskit_job(payload: Dict[str, Any]) -> Dict[str, Any]:
    t0 = time.perf_counter()

    import numpy as np  # type: ignore
    from scipy.optimize import minimize  # type: ignore
    from qiskit import transpile  # type: ignore
    from qiskit import qasm3  # type: ignore

    n_qubits = int(payload["nQubits"])
    linear = [float(x) for x in payload["linear"]]
    edges = payload["edges"]
    h_fields = [float(x) for x in payload["hFields"]]
    j_edges = payload["jEdges"]
    energy_scale = float(payload.get("energyScale", 1.0))
    layers_p = max(1, min(6, int(payload.get("layersP", 2))))
    shots = max(128, min(100000, int(payload.get("shots", 2048))))
    algorithm = str(payload.get("algorithm", "QAOA"))
    optimizer = str(payload.get("optimizer", "COBYLA"))
    backend_id = str(payload.get("backend", "aer_simulator (statevector)"))
    backend_name = backend_id.split(" ")[0].strip()

    use_ibm_cloud = not backend_name.startswith("aer_simulator") and bool(
        os.environ.get("IBM_QUANTUM_TOKEN", "").strip()
    )

    # Parameter vector initialization
    if algorithm == "VQA":
        init_params = [0.45 + 0.15 * ((i % 3) - 1) for i in range(layers_p * n_qubits)]
    else:
        init_params = []
        for layer in range(layers_p):
            frac = (layer + 1) / (layers_p + 1)
            init_params.extend([0.55 * frac, 0.38 * (1.0 - 0.5 * frac)])

    # Step 1: Optimize angles with real Qiskit AerSimulator (fast variational loop)
    from qiskit_aer import AerSimulator  # type: ignore

    aer_sim = AerSimulator()
    cvar_alpha = 0.25 if algorithm == "CVaR-QAOA" else 1.0

    def evaluate_counts(counts: Dict[str, int]) -> Tuple[float, float, str, List[Dict[str, Any]]]:
        total = max(1, sum(counts.values()))
        scored: List[Tuple[float, str, int]] = []
        exp_energy = 0.0
        for raw_bits, cnt in counts.items():
            # Qiskit returns little-endian strings (q_{n-1}...q_0); reverse to align q_0 -> node 0
            q0_bits = raw_bits.replace(" ", "")[::-1][:n_qubits].ljust(n_qubits, "0")
            e_val = eval_qubo_bitstring(q0_bits, linear, edges)
            scored.append((e_val, q0_bits, int(cnt)))
            exp_energy += e_val * (cnt / total)

        scored.sort(key=lambda item: item[0])
        best_energy, best_bits, _ = scored[0]

        # CVaR tail average
        if cvar_alpha < 1.0:
            target_shots = max(1, int(total * cvar_alpha))
            acc_e = 0.0
            acc_c = 0
            for e_val, _, cnt in scored:
                take = min(cnt, target_shots - acc_c)
                acc_e += e_val * take
                acc_c += take
                if acc_c >= target_shots:
                    break
            objective = acc_e / max(1, acc_c)
        else:
            objective = exp_energy

        by_freq = sorted(scored, key=lambda item: item[2], reverse=True)[:8]
        top_bitstrings = [
            {
                "bitstring": f"|{bits}⟩",
                "counts": cnt,
                "probability": round(cnt / total, 4),
                "energyCost": round(e_val, 3),
                "isOptimal": bits == best_bits,
            }
            for e_val, bits, cnt in by_freq
        ]
        return objective, exp_energy, best_bits, top_bitstrings

    opt_shots = min(shots, 1024)
    scipy_method = "Powell" if optimizer == "Powell" else "Nelder-Mead" if optimizer == "NELDER_MEAD" else "COBYLA"

    def cost_fn(theta: np.ndarray) -> float:
        qc = build_ansatz_circuit(
            n_qubits, h_fields, j_edges, layers_p, algorithm, theta.tolist(), energy_scale
        )
        t_qc = transpile(qc, aer_sim, optimization_level=1)
        res = aer_sim.run(t_qc, shots=opt_shots).result()
        obj, _, _, _ = evaluate_counts(res.get_counts())
        return obj

    opt_res = minimize(
        cost_fn,
        np.array(init_params, dtype=float),
        method=scipy_method,
        options={"maxiter": 28},
    )
    optimal_angles = [round(float(x), 5) for x in opt_res.x.tolist()]

    final_qc = build_ansatz_circuit(
        n_qubits, h_fields, j_edges, layers_p, algorithm, optimal_angles, energy_scale
    )
    openqasm3_str = qasm3.dumps(final_qc)

    # Step 2: Execute final optimized circuit on real IBM Quantum QPU (SamplerV2) OR AerSimulator
    if use_ibm_cloud:
        from qiskit_ibm_runtime import QiskitRuntimeService, SamplerV2 as Sampler  # type: ignore
        from qiskit.transpiler.preset_passmanagers import generate_preset_pass_manager  # type: ignore

        token = os.environ.get("IBM_QUANTUM_TOKEN", "").strip()
        instance = os.environ.get("IBM_QUANTUM_INSTANCE", "").strip() or None
        service = QiskitRuntimeService(channel="ibm_quantum_platform", token=token, instance=instance)
        qpu_backend = service.backend(backend_name)
        pm = generate_preset_pass_manager(optimization_level=1, backend=qpu_backend)
        isa_qc = pm.run(final_qc)
        sampler = Sampler(mode=qpu_backend)
        job = sampler.run([isa_qc], shots=shots)
        job_id = job.job_id()
        two_q_gates = sum(1 for inst in isa_qc.data if len(inst.qubits) >= 2)

        return {
            "executionEngine": "qiskit_local_python",
            "jobId": job_id,
            "backendName": backend_name,
            "status": "QUEUED",
            "qubits": n_qubits,
            "layersP": layers_p,
            "shots": shots,
            "transpiledDepth": int(isa_qc.depth()),
            "twoQubitGateCount": int(two_q_gates),
            "openQasm3": openqasm3_str,
            "optimalAngles": optimal_angles,
            "runtimeMs": round((time.perf_counter() - t0) * 1000, 1),
        }

    # Execute final high-shot sampling on real Qiskit AerSimulator
    transpiled_qc = transpile(final_qc, aer_sim, optimization_level=1)
    two_q_gates = sum(1 for inst in transpiled_qc.data if len(inst.qubits) >= 2)
    job = aer_sim.run(transpiled_qc, shots=shots)
    counts = job.result().get_counts()
    _, exp_energy, best_bits, top_bitstrings = evaluate_counts(counts)
    best_energy = eval_qubo_bitstring(best_bits, linear, edges)

    return {
        "executionEngine": "qiskit_local_python",
        "jobId": f"qiskit-aer-{int(time.time() * 1000)}",
        "backendName": "qiskit_aer.AerSimulator",
        "status": "COMPLETED",
        "qubits": n_qubits,
        "layersP": layers_p,
        "shots": shots,
        "transpiledDepth": int(transpiled_qc.depth()),
        "twoQubitGateCount": int(two_q_gates),
        "openQasm3": openqasm3_str,
        "optimalBitstring": best_bits,
        "achievedQuboEnergy": round(best_energy, 4),
        "expectationQuboEnergy": round(exp_energy, 4),
        "topBitstrings": top_bitstrings,
        "optimalAngles": optimal_angles,
        "runtimeMs": round((time.perf_counter() - t0) * 1000, 1),
    }


def main() -> None:
    if "--probe" in sys.argv:
        print(json.dumps(probe_environment()))
        return

    raw = sys.stdin.read()
    if not raw.strip():
        print(json.dumps({"error": "Empty JSON payload on stdin."}))
        sys.exit(1)

    try:
        payload = json.loads(raw)
        result = execute_qiskit_job(payload)
        print(json.dumps(result))
    except Exception as exc:
        print(json.dumps({"error": f"Qiskit execution error: {exc}"}))
        sys.exit(1)


if __name__ == "__main__":
    main()
