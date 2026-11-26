import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import {
  buildIsaOpenQasm3Circuit,
  buildOpenQasm3Circuit,
  extractAllPubCountsFromIbmRestResult,
  extractCountsFromIbmRestResult,
  GATE_BASED_QPU_ALGORITHMS,
  getQiskitRuntimeCapabilities,
  scoreMeasuredCountsAgainstMicrogrid,
} from './qiskitExecutor';
import { buildFullMicrogridQuboProblem, generateMicrogridTopology } from '../src/engine/quboSolverEngine';
import { quboToIsing } from '../src/engine/realQuantumSolvers';
import { NOMINAL_CLIMATE_CONDITIONS } from '../src/constants';

test('buildOpenQasm3Circuit emits valid OpenQASM 3.0 with exact qubits, RZZ decomposition, and BF-DCQO counterdiabatic RY', () => {
  const topo = generateMicrogridTopology(6, 0.4, NOMINAL_CLIMATE_CONDITIONS);
  const { problem } = buildFullMicrogridQuboProblem(topo, NOMINAL_CLIMATE_CONDITIONS, [
    'thermal_limits',
    'voltage_stability',
  ]);
  const ising = quboToIsing(problem);

  const qaoaOut = buildOpenQasm3Circuit({
    nQubits: 6,
    hFields: ising.h,
    jEdges: ising.J,
    energyScale: ising.energyScale,
    layersP: 2,
    algorithm: 'QAOA',
    angles: [0.45, 0.3, 0.65, 0.2],
  });

  assert.ok(qaoaOut.openQasm3.startsWith('OPENQASM 3.0;'));
  assert.ok(qaoaOut.openQasm3.includes('qubit[6] q;'));
  assert.ok(qaoaOut.openQasm3.includes('bit[6] c;'));
  assert.ok(qaoaOut.openQasm3.includes('c = measure q;'));
  assert.ok(qaoaOut.twoQubitGateCount > 0);
  assert.ok(qaoaOut.openQasm3.includes('cx q['));

  const bfOut = buildOpenQasm3Circuit({
    nQubits: 6,
    hFields: ising.h,
    jEdges: ising.J,
    energyScale: ising.energyScale,
    layersP: 1,
    algorithm: 'BF-DCQO',
    angles: [0.5, 0.3],
  });
  assert.ok(bfOut.openQasm3.includes('ry('), 'BF-DCQO circuit must include counterdiabatic RY rotations');
});

test('buildIsaOpenQasm3Circuit emits strict IBM Heron ISA OpenQASM 3.0 with only native rz/sx/cz gates on valid physical coupling edges', () => {
  const topo = generateMicrogridTopology(6, 0.5, NOMINAL_CLIMATE_CONDITIONS);
  const { problem } = buildFullMicrogridQuboProblem(topo, NOMINAL_CLIMATE_CONDITIONS, [
    'thermal_limits',
    'voltage_stability',
  ]);
  const ising = quboToIsing(problem);

  // Sparse linear heavy-hex-like segment forcing real SWAP routing
  const couplingMap: [number, number][] = [
    [0, 1], [1, 0],
    [1, 2], [2, 1],
    [2, 3], [3, 2],
    [3, 4], [4, 3],
    [4, 5], [5, 4],
  ];
  const validEdgeSet = new Set(couplingMap.map(([u, v]) => `${u},${v}`));

  const isaOut = buildIsaOpenQasm3Circuit({
    nQubits: 6,
    hFields: ising.h,
    jEdges: ising.J,
    energyScale: ising.energyScale,
    layersP: 1,
    algorithm: 'QAOA',
    angles: [0.48, 0.31],
    basisGates: ['cz', 'id', 'rz', 'sx', 'x'],
    couplingMap,
  });

  assert.equal(isaOut.nativeTwoQubitGate, 'cz');
  assert.ok(isaOut.openQasm3.startsWith('OPENQASM 3.0;'));
  assert.ok(isaOut.openQasm3.includes('bit[6] c;'));
  assert.ok(!isaOut.openQasm3.includes('qubit['), 'ISA circuit must use physical qubits ($p), not virtual qubit registers');

  const lines = isaOut.openQasm3.split('\n').slice(3);
  for (const line of lines) {
    if (line.startsWith('c[')) {
      assert.match(line, /^c\[\d+\] = measure \$\d+;$/);
      continue;
    }
    if (line.startsWith('cz ')) {
      const m = line.match(/^cz \$(\d+), \$(\d+);$/);
      assert.ok(m, `Invalid CZ syntax: ${line}`);
      assert.ok(validEdgeSet.has(`${m[1]},${m[2]}`), `CZ edge (${m[1]}, ${m[2]}) is not in hardware coupling_map`);
      continue;
    }
    assert.ok(
      /^rz\([-0-9.]+\) \$\d+;$/.test(line) || /^sx \$\d+;$/.test(line),
      `Non-ISA gate emitted: ${line}`
    );
  }
  for (let i = 0; i < 6; i++) {
    assert.ok(isaOut.openQasm3.includes(`c[${i}] = measure $`), `Missing measurement for logical qubit ${i}`);
  }
});

test('extractCountsFromIbmRestResult decodes IBM Quantum Platform SamplerV2 hex sample arrays', () => {
  const ibmPayload = {
    results: [
      {
        data: {
          c: {
            samples: ['0x15', '0x15', '0x2a', '0x15', '0x0f'],
          },
        },
      },
    ],
  };

  const counts = extractCountsFromIbmRestResult(ibmPayload, 6);
  assert.equal(counts['010101'], 3);
  assert.equal(counts['101010'], 1);
  assert.equal(counts['001111'], 1);
});

test('extractCountsFromIbmRestResult decodes Qiskit Runtime RuntimeEncoder PrimitiveResult BitArray (.npy + zlib)', () => {
  // Build minimal valid NumPy v1.0 .npy buffer for shape (4, 1) uint8: [0b010101, 0b010101, 0b101010, 0b001111]
  const headerStr = "{'descr': '|u1', 'fortran_order': False, 'shape': (4, 1), }";
  const padLen = 16 - ((10 + headerStr.length + 1) % 16);
  const fullHeader = Buffer.from(headerStr + ' '.repeat(padLen) + '\n', 'ascii');
  const magic = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00]);
  const lenBuf = Buffer.alloc(2);
  lenBuf.writeUInt16LE(fullHeader.length, 0);
  const rawSamples = Buffer.from([0x15, 0x15, 0x2a, 0x0f]);
  const npy = Buffer.concat([magic, lenBuf, fullHeader, rawSamples]);
  const encoded = deflateSync(npy).toString('base64');

  const runtimeEncodedPayload = {
    __type__: 'PrimitiveResult',
    __value__: {
      pub_results: [
        {
          __type__: 'SamplerPubResult',
          __value__: {
            data: {
              __type__: 'DataBin',
              __value__: {
                fields: {
                  c: {
                    __type__: 'BitArray',
                    __value__: {
                      array: {
                        __type__: 'ndarray',
                        __value__: encoded,
                      },
                      num_bits: 6,
                    },
                  },
                },
              },
            },
          },
        },
      ],
    },
  };

  const counts = extractCountsFromIbmRestResult(runtimeEncodedPayload, 6);
  assert.equal(counts['010101'], 2);
  assert.equal(counts['101010'], 1);
  assert.equal(counts['001111'], 1);
});

test('scoreMeasuredCountsAgainstMicrogrid scores real Qiskit counts against QUBO ground state and microgrid KPIs', () => {
  const topo = generateMicrogridTopology(6, 0.35, NOMINAL_CLIMATE_CONDITIONS);
  const { problem } = buildFullMicrogridQuboProblem(topo, NOMINAL_CLIMATE_CONDITIONS, [
    'thermal_limits',
    'renewable_intermittency',
  ]);

  const scored = scoreMeasuredCountsAgainstMicrogrid({
    rawCounts: {
      '101010': 512,
      '111000': 256,
      '010101': 256,
    },
    topology: topo,
    climate: NOMINAL_CLIMATE_CONDITIONS,
    problem,
    nQubits: 6,
    littleEndian: true,
  });

  assert.ok(scored.optimalBitstring.startsWith('|') && scored.optimalBitstring.endsWith('⟩'));
  assert.ok(scored.approxRatio >= 0 && scored.approxRatio <= 1);
  assert.ok(scored.demandMetPct >= 55 && scored.demandMetPct <= 100);
  assert.equal(scored.topBitstrings.length, 3);
});

test('getQiskitRuntimeCapabilities accurately reports runtime configuration without faking Qiskit availability', async () => {
  const caps = await getQiskitRuntimeCapabilities();
  assert.ok(
    ['ibm_cloud_rest', 'qiskit_python_service', 'qiskit_local_python', 'unconfigured'].includes(
      caps.activeMode
    )
  );
  assert.ok(caps.setupHint.length > 0);
});

test('buildIsaOpenQasm3Circuit generates distinct valid Heron ISA circuits for all 5 gate-based QPU algorithms including VarQITE', () => {
  const topo = generateMicrogridTopology(6, 0.5, NOMINAL_CLIMATE_CONDITIONS);
  const { problem } = buildFullMicrogridQuboProblem(topo, NOMINAL_CLIMATE_CONDITIONS, [
    'thermal_limits',
    'voltage_stability',
  ]);
  const ising = quboToIsing(problem);
  const couplingMap: [number, number][] = [
    [0, 1], [1, 0],
    [1, 2], [2, 1],
    [2, 3], [3, 2],
    [3, 4], [4, 3],
    [4, 5], [5, 4],
  ];
  const validEdgeSet = new Set(couplingMap.map(([u, v]) => `${u},${v}`));

  assert.equal(GATE_BASED_QPU_ALGORITHMS.length, 5);
  const qasms = new Set<string>();

  for (const algo of GATE_BASED_QPU_ALGORITHMS) {
    const out = buildIsaOpenQasm3Circuit({
      nQubits: 6,
      hFields: ising.h,
      jEdges: ising.J,
      energyScale: ising.energyScale,
      layersP: 1,
      algorithm: algo,
      angles: [0.45, 0.31],
      basisGates: ['cz', 'id', 'rz', 'sx', 'x'],
      couplingMap,
    });
    assert.ok(out.openQasm3.startsWith('OPENQASM 3.0;'));
    assert.ok(out.twoQubitGateCount > 0, `${algo} must emit native 2Q gates`);
    for (const line of out.openQasm3.split('\n').slice(3)) {
      if (line.startsWith('cz ')) {
        const m = line.match(/^cz \$(\d+), \$(\d+);$/);
        assert.ok(m, `${algo} invalid CZ: ${line}`);
        assert.ok(validEdgeSet.has(`${m[1]},${m[2]}`), `${algo} CZ edge not in coupling_map`);
      }
    }
    qasms.add(out.openQasm3);
  }
  assert.ok(qasms.size >= 4, 'Multi-PUB batch must produce distinct ISA circuits across algorithms');
});

test('extractAllPubCountsFromIbmRestResult decodes all 5 PUBs from both RuntimeEncoder PrimitiveResult and plain REST results', () => {
  const makeBitArrayPub = (samples: number[]) => {
    const headerStr = `{'descr': '|u1', 'fortran_order': False, 'shape': (${samples.length}, 1), }`;
    const padLen = 16 - ((10 + headerStr.length + 1) % 16);
    const fullHeader = Buffer.from(headerStr + ' '.repeat(padLen) + '\n', 'ascii');
    const magic = Buffer.from([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 0x01, 0x00]);
    const lenBuf = Buffer.alloc(2);
    lenBuf.writeUInt16LE(fullHeader.length, 0);
    const npy = Buffer.concat([magic, lenBuf, fullHeader, Buffer.from(samples)]);
    const encoded = deflateSync(npy).toString('base64');
    return {
      __type__: 'SamplerPubResult',
      __value__: {
        data: {
          __type__: 'DataBin',
          __value__: {
            fields: {
              c: {
                __type__: 'BitArray',
                __value__: {
                  array: { __type__: 'ndarray', __value__: encoded },
                  num_bits: 6,
                },
              },
            },
          },
        },
      },
    };
  };

  const runtimeBatch = {
    __type__: 'PrimitiveResult',
    __value__: {
      pub_results: [
        makeBitArrayPub([0x15, 0x15]),
        makeBitArrayPub([0x2a, 0x2a]),
        makeBitArrayPub([0x0f, 0x15]),
        makeBitArrayPub([0x33, 0x33]),
        makeBitArrayPub([0x0c, 0x0c]),
      ],
    },
  };
  const decodedRuntime = extractAllPubCountsFromIbmRestResult(runtimeBatch, 6);
  assert.equal(decodedRuntime.length, 5);
  assert.equal(decodedRuntime[0]['010101'], 2);
  assert.equal(decodedRuntime[1]['101010'], 2);
  assert.equal(decodedRuntime[4]['001100'], 2);

  const plainRestBatch = {
    results: [
      { data: { c: { samples: ['0x15', '0x15'] } } },
      { data: { c: { samples: ['0x2a'] } } },
      { data: { c: { samples: ['0x0f'] } } },
      { data: { c: { samples: ['0x33'] } } },
      { data: { c: { samples: ['0x0c'] } } },
    ],
  };
  const decodedPlain = extractAllPubCountsFromIbmRestResult(plainRestBatch, 6);
  assert.equal(decodedPlain.length, 5);
  assert.equal(decodedPlain[0]['010101'], 2);
  assert.equal(decodedPlain[3]['110011'], 1);
});
