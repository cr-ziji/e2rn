export interface StageResult {
  name: string;
  status: 'success' | 'error' | 'skipped';
  duration: number;
  filesProcessed?: number;
  error?: string;
  details?: Record<string, any>;
}

export interface ProjectAnalysis {
  electronRoot: string;
  mainEntry?: string;
  preloadEntry?: string;
  rendererEntries?: string[];
  hasPackageJson: boolean;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  apisUsed: string[];
  builtinsUsed: string[];
  dynamicRequires: Array<{ filePath: string; line: number; column: number; codeSnippet: string; resolvable: boolean }>;
  nativeModules: Array<{ filePath: string; specifier: string; type: 'node-addon' | 'binding' | '.node' }>;
  hasPreload: boolean;
}