import type { ProjectAnalysis } from '@e2rn/types';

export async function scanProject(analysis: ProjectAnalysis): Promise<ProjectAnalysis> {
  // TODO: Implement AST scanning with @swc/core + ts-morph
  // - detect require('electron'), require('fs'), etc.
  // - detect ipcRenderer.sendSync, dynamic require, .node/native addons
  // For now return as-is (framework stub)
  return analysis;
}