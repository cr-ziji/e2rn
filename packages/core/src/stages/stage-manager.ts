import type { StageResult } from '@e2rn/types';

export interface Stage {
  name: string;
  run: () => Promise<Partial<StageResult>>;
}

export class StageManager {
  private stages: Stage[] = [];

  addStage(stage: Stage) {
    this.stages.push(stage);
  }

  async runAll(): Promise<StageResult[]> {
    const results: StageResult[] = [];

    for (const stage of this.stages) {
      const start = Date.now();
      try {
        const partial = await stage.run();
        results.push({
          name: stage.name,
          status: 'success',
          duration: Date.now() - start,
          filesProcessed: 0,
          ...partial,
        });
      } catch (error: any) {
        results.push({
          name: stage.name,
          status: 'error',
          duration: Date.now() - start,
          error: error?.message || String(error),
        });
        break;
      }
    }

    return results;
  }
}