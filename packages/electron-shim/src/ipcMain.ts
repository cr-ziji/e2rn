type Listener = (...args: any[]) => void;

const listeners = new Map<string, Set<Listener>>();
const handlers = new Map<string, (...args: any[]) => Promise<any> | any>();

export const ipcMain = {
  on: (channel: string, listener: Listener) => {
    if (!listeners.has(channel)) listeners.set(channel, new Set());
    listeners.get(channel)!.add(listener);
    return ipcMain;
  },
  once: (channel: string, listener: Listener) => {
    const wrapped = (...args: any[]) => {
      listener(...args);
      ipcMain.removeListener(channel, wrapped);
    };
    return ipcMain.on(channel, wrapped);
  },
  removeListener: (channel: string, listener: Listener) => {
    listeners.get(channel)?.delete(listener);
    return ipcMain;
  },
  handle: (channel: string, listener: (...args: any[]) => Promise<any> | any) => {
    handlers.set(channel, listener);
    return ipcMain;
  },
  removeHandler: (channel: string) => {
    handlers.delete(channel);
    return ipcMain;
  },
  emit: (channel: string, ...args: any[]) => {
    listeners.get(channel)?.forEach((l) => l(...args));
  },
  invoke: async (channel: string, ...args: any[]) => {
    const h = handlers.get(channel);
    if (!h) throw new Error(`No handler for channel: ${channel}`);
    return h(...args);
  },
};
export default ipcMain;