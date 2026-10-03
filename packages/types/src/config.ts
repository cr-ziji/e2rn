import type { E2RNPlugin, NodeRuntimePlugin, ElectronApiPlugin, BuiltinPolyfillPlugin, ContentTransformPlugin, ModuleMapperPlugin, TemplatePlugin } from './plugin';

export interface E2RNConfig {
  electronProjectPath: string;
  outputPath: string;
  projectName: string;
  appId: string;
  template?: string;

  runtime?: {
    engine?: any;
    autoStartNode?: boolean;
    mainEntry?: string;
    logLevel?: 'debug' | 'info' | 'warn' | 'error';
    bridge?: {
      supportBuffer?: 'base64' | 'arraybuffer' | 'none';
      maxMessageSize?: number;
      keepErrorStack?: boolean;
    };
  };

  electron?: {
    generateShim?: boolean;
    enabledApis?: string[];
    disabledApis?: string[];
    sendSyncStrategy?: 'async-promise' | 'throw' | 'warn';
    browserWindowDefaults?: {
      windowMode?: 'fullscreen' | 'desktop' | 'native';
      showTitleBar?: boolean;
      resizable?: boolean;
      movable?: boolean;
    };
  };

  polyfills?: {
    strategy?: 'auto' | 'strict' | 'permissive';
    include?: string[];
    exclude?: string[];
    custom?: Record<string, string | (() => any)>;
    dynamicRequire?: 'warn' | 'error' | 'ignore';
  };

  content?: {
    ast?: ContentTransformPlugin[];
    rules?: ContentTransformPlugin[];
  };

  moduleMapper?: ModuleMapperPlugin[];

  templateConfig?: Record<string, any>;

  plugins?: E2RNPlugin[];

  settings?: {
    preserveComments?: boolean;
    generateDiffReport?: boolean;
    autoCheck?: boolean;
    verbose?: boolean;
    concurrency?: number;
  };
}

export interface TemplatePlugin extends E2RNPlugin {
  type: 'template';
  templatesDir: string;
  files?: string[];
}