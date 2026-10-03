import type { ContentTransformPlugin } from '@e2rn/types';

export const astTransformPlugin: ContentTransformPlugin = {
  name: '@e2rn/plugin-ast-transform',
  type: 'content-transform',
  version: '0.1.0-alpha.0',
  description: 'AST transforms: electron->@e2rn/electron, process.versions.electron placeholder, ipcRenderer.sendSync -> async rewrite (default strategy async-promise)',
  hooks: {
    astTransform: async (ctx) => {
      // TODO: SWC-based transforms per design
      return ctx.ast;
    },
  },
};

export default astTransformPlugin;