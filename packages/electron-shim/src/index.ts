export * from './app.js';
export * from './ipcMain.js';
export * from './ipcRenderer.js';
export * from './browserWindow.js';
export * from './webContents.js';
export const contextBridge = {
  exposeInMainWorld: (_key: string, _value: any) => {},
};
export default {} as any;