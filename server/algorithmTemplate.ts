import type {
  ClassicalAlgorithm,
  ClimateConditions,
  ConstraintId,
  ExploreRunResult,
  GridTopology,
  QiskitBackend,
  QuantumAlgorithm,
} from '../src/types/grid';

export interface CustomAlgorithmInput {
  topology: GridTopology;
  quantumAlgorithm: QuantumAlgorithm;
  classicalAlgorithm: ClassicalAlgorithm;
  backend: QiskitBackend;
  shots: number;
  constraints: ConstraintId[];
  climate: ClimateConditions;
  partitionQubits: number;
}

export const CUSTOM_ALGORITHM_TEMPLATE = {
  id: 'Custom Algorithm (Template)' as const,
  version: '1.0.0',
  filePath: 'server/algorithmTemplate.ts',
  isImplemented: false,
  notes: 'Implement runCustomQuantumAlgorithm() to plug a custom solver into POST /api/optimize.',
};

export async function runCustomQuantumAlgorithm(
  _input: CustomAlgorithmInput
): Promise<ExploreRunResult | null> {
  return null;
}
