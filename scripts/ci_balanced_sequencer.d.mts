import type { BaseSequencer, TestSpecification } from 'vitest/node';

export declare class BalancedSequencer extends BaseSequencer {
  shard(files: TestSpecification[]): Promise<TestSpecification[]>;
}

export default BalancedSequencer;
