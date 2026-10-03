type Listener = (...args: any[]) => void;

const listeners = new Map<string, Set<Listener>>();

export const ipcRenderer = {
  send: (channel: string, ...args: any[]) => {
    // In-Process: bridge will dispatch to ipcMain
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.sendToMain(channel, ...args);
    }
  },
  sendSync: (channel: string, ...args: any[]) => {
    // Default behavior per design: async-promise strategy recommended at transform time
    // Keep sync-like throw or return undefined as minimal shim; actual conversion rewrites to invoke
    console.warn('[e2rn] ipcRenderer.sendSync called. Use invoke/send+on. See MIGRATION_GUIDE.');
    return undefined;
  },
  invoke: async (channel: string, ...args: any[]) => {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      return (globalThis as any).__E2RN_BRIDGE__.invokeMain(channel, ...args);
    }
    throw new Error(`No bridge available for invoke: ${channel}`);
  },
  on: (channel: string, listener: Listener) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(listener);
    return ipcRenderer;
  },
  once: (channel: string, listener: Listener) => {
    const wrapped = (...args: any[]) => {
      listener(...args);
      ipcRenderer.removeListener(channel, wrapped);
    };
    return ipcRenderer.on(channel, wrapped);
  },
  removeListener: (channel: string, listener: Listener) => {
    listeners.get(channel)?.delete(listener);
    return ipcRenderer;
  },
  receive: (channel: string, ...args: any[]) => {
    listeners.get(channel)?.forEach((l) => l(...args));
  },
};
export default ipcRenderer;