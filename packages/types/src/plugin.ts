export type PluginType =
  | 'electron-api'
  | 'builtin-polyfill'
  | 'module-mapper'
  | 'content-transform'
  | 'template'
  | 'window-ui'
  | 'post-process'
  | 'runtime-extension';

export interface ViableCheck {
  solved: boolean;
  message: string;
  severity?: 'info' | 'warn' | 'error';
}

export interface E2RNPlugin {
  name: string;
  type: PluginType;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  enabled?: boolean;
  priority?: number;
  dependsOn?: string[];
  conflictsWith?: string[];
  requires?: {
    platforms?: ('android' | 'ios')[];
    rnVersion?: string;
    hermes?: boolean;
    e2rnVersion?: string;
  };
  checkViable?: Record<string, boolean | ViableCheck>;
}

export interface ElectronApiPlugin extends E2RNPlugin {
  type: 'electron-api';
  apiName: string | string[];
  exportPaths?: string[];
  implementation: {
    renderer?: string;
    main?: string;
  };
  dependencies?: Record<string, string>;
  capabilities?: string[];
  missingSubApis?: string[];
}

export interface BuiltinPolyfillPlugin extends E2RNPlugin {
  type: 'builtin-polyfill';
  builtinName: string | string[];
  implementation: string;
  strategy?: 'alias' | 'inject-global' | 'conditional';
  condition?: (ctx: any) => boolean;
  rnFsBackend?: boolean;
  limitations?: string[];
}

export interface ModuleMapperRule {
  from: string | RegExp;
  to: string | ((ctx: { request: string; filePath: string }) => string | null);
  scope?: 'import' | 'require' | 'both';
  condition?: (ctx: any) => boolean;
}

export interface ModuleMapperPlugin extends E2RNPlugin {
  type: 'module-mapper';
  rules: ModuleMapperRule[];
}

export interface TransformContext {
  filePath: string;
  relativePath: string;
  content: string;
  ast?: any;
  language: 'js' | 'ts' | 'tsx' | 'jsx' | 'json' | 'html' | 'css' | 'other';
  config: any;
  project: { electronRoot: string; outputRoot: string };
}

export interface FileAction {
  action: 'copy' | 'skip' | 'transform' | 'delete';
  content?: string;
  reason?: string;
}

export interface ContentTransformPlugin extends E2RNPlugin {
  type: 'content-transform';
  include?: string[];
  exclude?: string[];
  hooks?: {
    beforeCopy?: (ctx: TransformContext) => Promise<FileAction | void>;
    onTransform?: (ctx: TransformContext) => Promise<string | void>;
    astTransform?: (ctx: TransformContext & { ast: any }) => Promise<any | void>;
    afterTransform?: (ctx: TransformContext) => Promise<void>;
  };
  rules?: Array<{
    name: string;
    pattern: string | RegExp;
    replacement: string | ((m: string, ...a: any[]) => string);
    files?: string[];
    type?: 'string' | 'regex' | 'function';
  }>;
}
