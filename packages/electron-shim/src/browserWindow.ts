export interface BrowserWindowOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  frame?: boolean;
  titleBarStyle?: 'default' | 'hidden' | 'hiddenInset' | 'customButtonsOnHover';
  resizable?: boolean;
  movable?: boolean;
  show?: boolean;
  parent?: BrowserWindow;
  webPreferences?: any;
}

let idCounter = 0;

export class BrowserWindow {
  id: number;
  webContents: any;
  private _options: BrowserWindowOptions;

  constructor(options: BrowserWindowOptions = {}) {
    this.id = ++idCounter;
    this._options = options;
    this.webContents = {
      send: (channel: string, ...args: any[]) => {
        if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
          (globalThis as any).__E2RN_BRIDGE__.sendToWeb(this.id, channel, ...args);
        }
      },
      executeJavaScript: async (_code: string) => {
        // WebView inject handled by bridge
        return true;
      },
    };
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.createWindow(this.id, options);
    }
  }

  loadURL(url: string) {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.loadURL(this.id, url);
    }
    return this;
  }

  loadFile(filePath: string, options?: any) {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.loadFile(this.id, filePath, options);
    }
    return this;
  }

  show() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.showWindow(this.id);
    }
    return this;
  }

  hide() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.hideWindow(this.id);
    }
    return this;
  }

  focus() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.focusWindow(this.id);
    }
    return this;
  }

  close() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.closeWindow(this.id);
    }
    return this;
  }

  minimize() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.minimizeWindow(this.id);
    }
    return this;
  }

  maximize() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.maximizeWindow(this.id);
    }
    return this;
  }

  restore() {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.restoreWindow(this.id);
    }
    return this;
  }

  setSize(width: number, height: number, animate?: boolean) {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.setWindowSize(this.id, width, height, animate);
    }
    return this;
  }

  setPosition(x: number, y: number, animate?: boolean) {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.setWindowPosition(this.id, x, y, animate);
    }
    return this;
  }

  getBounds() {
    return { x: 0, y: 0, width: 800, height: 600 };
  }

  setBounds(bounds: any, animate?: boolean) {
    if (typeof globalThis !== 'undefined' && (globalThis as any).__E2RN_BRIDGE__) {
      (globalThis as any).__E2RN_BRIDGE__.setWindowBounds(this.id, bounds, animate);
    }
    return this;
  }
}

export default BrowserWindow;