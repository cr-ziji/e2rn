import type { BuiltinPolyfillPlugin } from '@e2rn/types';

export const nodeBuiltinPolyfillsBase: BuiltinPolyfillPlugin = {
  name: '@e2rn/plugin-node-builtin-polyfills',
  type: 'builtin-polyfill',
  version: '0.1.0-alpha.0',
  description: 'Base Node builtins polyfills (path, util, events, buffer, timers, stream, assert, url, querystring)',
  builtinName: ['path', 'util', 'events', 'buffer', 'timers', 'stream', 'assert', 'url', 'querystring'],
  implementation: './runtime.js',
  strategy: 'alias',
};

export default nodeBuiltinPolyfillsBase;