export const app = {
  isPackaged: false,
  quit: () => {},
  exit: (_code?: number) => {},
  relaunch: (_options?: any) => {},
  whenReady: () => Promise.resolve(),
  on: (_event: string, _listener: (...args: any[]) => void) => app,
  once: (_event: string, _listener: (...args: any[]) => void) => app,
  removeListener: (_event: string, _listener: (...args: any[]) => void) => app,
  getPath: (_name: string) => '',
};
export default app;