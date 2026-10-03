import type { ProjectAnalysis } from '@e2rn/types';
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export async function analyzeProject(electronRoot: string): Promise<ProjectAnalysis> {
  const root = resolve(electronRoot);
  const pkgPath = join(root, 'package.json');
  let pkg: any = {};

  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
    } catch {
      pkg = {};
    }
  }

  return {
    electronRoot: root,
    mainEntry: pkg.main,
    preloadEntry: undefined,
    rendererEntries: [],
    hasPackageJson: existsSync(pkgPath),
    dependencies: pkg.dependencies || {},
    devDependencies: pkg.devDependencies || {},
    apisUsed: [],
    builtinsUsed: [],
    dynamicRequires: [],
    nativeModules: [],
    hasPreload: false,
  };
}