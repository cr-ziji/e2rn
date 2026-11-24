# 06 · 运行时 API 契约

> 这一章是 `@e2rn/electron` 的**行为合同**：每个成员支持到什么程度、差异在哪、不支持时抛什么。
> 支持矩阵的汇总视图见 [03-compatibility.md](03-compatibility.md)。

## 1. 总则

### 1.1 错误规范

不支持的 API 必须在**调用点**失败，而不是返回 `undefined` 让错误延后爆炸。

```text
[e2rn] dialog.showMessageBoxSync() is not supported on mobile.
  Why : 移动端无法阻塞 UI 线程；同步对话框没有等价实现。
  Fix : 改为 await dialog.showMessageBox(...)
  Rule: electron-api.dialog.showMessageBoxSync
```

约定：

- 同步 API → **同步 throw**；异步 API → **rejected Promise**。不要混。
- 错误信息必须包含 `Why` 与 `Fix` 两行，便于直接贴进 issue。
- 同一调用点只打印一次告警（用 `WeakSet` 记录），避免刷屏。

### 1.2 返回值规范

| 场景 | 返回 |
|---|---|
| 语义等价的查询 | 真实值（如 `win.id`、`app.getPath()`） |
| 无法精确获知但必须有值 | 合理默认值 + 一次性告警（如 `webContents.getZoomFactor() → 1`） |
| 可选增强且不影响正确性 | **no-op + 一次性告警**（如 `setAlwaysOnTop`、`appendSwitch`）；这类调用通常是"有更好，没有也能跑" |
| 核心能力无法实现 | 抛错，不返回 `null`/`undefined` |
| 事件监听类 | 返回 `this` 以支持链式调用 |

区分"可选增强"与"核心能力"的标准：**忽略它，业务结果是否仍然正确**。`setAlwaysOnTop` 忽略后只是体验差；`showSaveDialog` 忽略后用户拿不到文件，必须抛错。

### 1.3 事件规范

- 事件回调统一 `listener(event, ...args)` 形态，`event` 至少含 `sender`。
- 已发生过的"一次性"事件（`ready`）不再补发，除非显式 `whenReady`。
- 监听器异常必须被捕获并转发到日志，不能中断事件循环。

## 2. `app`

| 成员 | 级别 | 行为与差异 |
|---|---|---|
| `whenReady()` | 等价 | 根组件挂载前 resolve；重复 await 安全 |
| `on/once/off` | 等价 | 支持 `ready` `activate` `window-all-closed` `before-quit` `will-quit` `quit` `child-process-gone` |
| `getPath(name)` | 近似 | 映射沙盒目录（[03](03-compatibility.md) §5.3）；`downloads` 在 iOS 不可直接访问 |
| `getAppPath()` | 近似 | 返回资源根目录（asset root），不是安装路径 |
| `getName/getVersion` | 等价 | 来自 `app.json` / `package.json` |
| `isPackaged` | 近似 | `__DEV__ === false` 时为 `true` |
| `quit()/exit()` | 受限 | 关闭窗口并触发 `before-quit`/`will-quit`；iOS 不允许程序化退出，降级为回到桌面 |
| `relaunch()` | 受限 | 仅开发态有效（重启 JS），生产态抛错 |
| `focus()/hide()/show()` | 受限 | 映射到应用前后台；`hide` 在 Android 上是最小化 |
| `requestSingleInstanceLock()` | 近似 | 恒 `true`；`second-instance` 永不触发 |
| `setBadgeCount(n)` | 需原生 | 走原生角标；未安装时 no-op + 告警 |
| `getLocale()` | 等价 | 来自系统 Locale |
| `commandLine.appendSwitch()` | 受限 | 必须在 `ready` 前调用；之后调用无效（不抛错，避免启动期崩溃） |
| `setAsDefaultProtocolClient()` | 不支持 | 移动端用 Universal Link / App Link，需原生配置 |
| `getFileIcon()` | 不支持 | 无系统图标 API |
| `dock` / `setUserTasks` / `JumpList` | 不支持 | 桌面专属 |

## 3. `BrowserWindow`

### 3.1 构造选项

| 选项 | 行为 |
|---|---|
| `width/height/x/y` | 仅 `stack` / `desktop` 模式生效；`fullscreen` 下忽略 |
| `show` | 支持；`false` 时先创建不显示，`ready-to-show` 后由用户调用 `show()` |
| `frame` / `titleBarStyle` / `trafficLightPosition` | 忽略（无原生窗口装饰）；用 `ui.window.titleBar` 插件实现 |
| `resizable` / `movable` / `minimizable` / `maximizable` | 仅窗口化模式生效 |
| `fullscreen` | 支持（默认模式即全屏） |
| `parent` / `modal` | 支持父子关系与层级；`modal` 仅阻止父窗口交互，不阻止系统返回 |
| `alwaysOnTop` / `opacity` / `transparent` / `skipTaskbar` | 忽略 |
| `backgroundColor` | 支持（窗口底色，避免白闪） |
| `webPreferences.preload` | 支持；preload 会被打成 IIFE 注入（[07](07-renderer.md) §4） |
| `webPreferences.additionalArguments` | 支持；通过 `window.__E2RN_ARGV__` 传给渲染层 |
| `webPreferences.nodeIntegration` | 忽略（渲染层永远没有 Node） |
| `webPreferences.contextIsolation` / `sandbox` | 忽略（WebView 无隔离世界） |
| `webPreferences.partition` | 忽略（无独立会话） |

### 3.2 方法与事件

| 成员 | 级别 | 说明 |
|---|---|---|
| `loadURL/loadFile/reload` | 等价 | 同 URL 重复加载通过 `reloadNonce` 强制重挂载 |
| `show/hide/focus/blur` | 等价 | 状态进 WindowStore，UI 响应式更新 |
| `close/destroy` | 等价 | `close` 可被 `close` 事件取消；`destroy` 强制 |
| `isDestroyed/isVisible/isFocused/isMinimized/isMaximized` | 等价 | 读 store |
| `isFullScreen()` | 近似 | `fullscreen` 模式恒 `true`；其它模式按状态 |
| `maximize/unmaximize/minimize/restore` | 近似 | 窗口化模式有效；全屏模式为 no-op |
| `setBounds/getBounds/setSize/setPosition` | 近似 | 全屏模式忽略写入，`getBounds` 返回屏幕尺寸 |
| `setTitle/getTitle` | 等价 | 标题进入 store，标题栏/任务切换器可见 |
| `setAlwaysOnTop/setOpacity/setSkipTaskbar/setIgnoreMouseEvents` | 不支持 | no-op + 一次性告警（这类调用通常是可选增强，抛错反而破坏兼容） |
| `setParentWindow/getParentWindow/getChildWindows` | 近似 | 支持层级与关闭联动 |
| `BrowserWindow.fromId/getAllWindows/getFocusedWindow` | 等价 | 从 WindowStore 查询 |
| 事件 `ready-to-show` | 近似 | 首次 `did-finish-load` 后触发一次 |
| 事件 `close/closed/focus/blur/show/hide/resize/move` | 等价 | 由 UI 与 store 驱动 |
| 事件 `enter-full-screen/leave-full-screen` | 受限 | 仅在模式切换时触发，不跟随系统手势 |
| 事件 `page-title-updated` | 等价 | 来自 WebView 的标题变化 |

## 4. `webContents`

| 成员 | 级别 | 说明 |
|---|---|---|
| `send(channel, ...args)` | 等价 | 加载完成前入队，`did-finish-load` 后 flush |
| `executeJavaScript(code)` | 受限 | 能执行；**Android 拿不到返回值**，Promise resolve 为 `undefined`。需要返回值时用 `runtime.evalWithResult(winId, code)`（注入 + 关联 id 回传） |
| `executeJavaScriptInIsolatedWorld` | 不支持 | 无隔离世界 |
| `insertCSS/removeInsertedCSS` | 近似 | 通过注入 `<style>` 实现；返回的 key 用于移除 |
| `openDevTools/closeDevTools/isDevToolsOpened` | 不支持 | 用 `chrome://inspect`（Android）或 Safari 调试（iOS） |
| `reload/reloadIgnoringCache/stop` | 等价 | 映射到 WebView |
| `getURL/getTitle` | 等价 | 由 WebView 事件维护 |
| `isLoading/isDestroyed/isFocused` | 等价 | 读状态 |
| `setZoomFactor/getZoomFactor` | 受限 | Android WebView 支持 `setTextZoom` 近似；iOS 不支持 |
| `print/printToPDF` | 需原生 | 依赖原生打印/PDF 生成，未内置 |
| `capturePage()` | 受限 | Android 可用 `drawViewHierarchyInRect`；iOS 需 `takeSnapshot` |
| `postMessage/startDrag/sendInputEvent` | 不支持 | 无跨进程端口/拖拽/输入注入 |
| 事件 `did-start-loading/did-finish-load/did-fail-load/dom-ready/destroyed` | 等价 | 由 WebView 生命周期驱动 |

## 5. IPC

### 5.1 `ipcMain`

| 成员 | 级别 | 说明 |
|---|---|---|
| `on/once/off/removeListener/removeAllListeners` | 等价 | 同一 channel 重复 `on` 只桥接一次，避免重复投递 |
| `handle/handleOnce/removeHandler` | 等价 | 返回 Promise；异常转成 rejected |
| `emit(channel, ...args)` | 等价 | 主进程内部自触发，`senderId = -1` |

`IpcMainEvent` 形状：

```ts
{
  senderId: number,
  sender: WebContents,        // 必须是该窗口的实例，不能是临时对象
  senderFrame: { url?: undefined, parent: null },
  channel: string,
  reply(channel, ...args): void,
  returnValue?: unknown       // 当前实现不生效（无同步回传通道）
}
```

> `sender` 必须提供 `isDestroyed()`、`send()`、`once('destroyed')`、`getURL()`。真实工程会在 IPC 回调里调用它们，缺一个就是 "undefined is not a function"。

### 5.2 `ipcRenderer`

| 成员 | 级别 | 说明 |
|---|---|---|
| `send(channel, ...args)` | 等价 | 单向；无接收方时静默 |
| `invoke(channel, ...args)` | 等价 | 无 handler → reject（错误信息含 channel 名） |
| `on/once/off/removeAllListeners` | 等价 | 监听器在页面卸载时自动清理 |
| `sendSync(channel, ...args)` | 受限 | 见 §5.3 |
| `postMessage/sendToHost` | 不支持 | 无 MessagePort / host 通道 |

### 5.3 `sendSync` 三策略

```ts
// e2rn.config.ts
electron: { sendSyncStrategy: 'warn' }   // 'warn' | 'throw' | 'snapshot'
```

| 策略 | 行为 | 适用 |
|---|---|---|
| `warn`（默认） | 返回 `undefined` + 一次性告警 + 报告列出全部调用点 | 迁移期，先跑起来 |
| `throw` | 直接抛错 | 要求零语义妥协的工程 |
| `snapshot` | 返回窗口加载前主进程推送的快照值；未声明的 channel 返回 `undefined` 并告警 | 启动期读常量配置 |

`snapshot` 用法：

```ts
// 主进程
runtime.syncSnapshot({ 'app-config': { theme: 'dark', locale: 'zh-CN' } });
```

限制：快照在窗口创建时推送一次；之后主进程改值不会同步。只适合只读配置。

## 6. `contextBridge`

| 成员 | 级别 | 说明 |
|---|---|---|
| `exposeInMainWorld(key, api)` | 近似 | 在 WebView 的 `window` 上挂对象；函数跨边界时会被包成异步可调用代理 |
| `exposeInIsolatedWorld` | 不支持 | WebView 无隔离世界，安全边界弱于 Electron |
| `executeInMainWorld` | 不支持 | 同上 |

安全提示：`exposeInMainWorld` 暴露的对象直接位于页面上下文，页面脚本可以改写它。不要把"未校验的通道名"或"任意路径读写"暴露出去。

## 7. `dialog`

| 成员 | 级别 | 说明 |
|---|---|---|
| `showMessageBox(options)` | 近似 | 自绘 Modal；支持 `title` `message` `detail` `buttons` `defaultId` `cancelId`；`checkboxLabel` 忽略 |
| `showMessageBox(win, options)` | 近似 | 同上，窗口归属用于居中与模态 |
| `showMessageBoxSync` | 不支持 | 无法阻塞 UI 线程 |
| `showOpenDialog` | 需原生 | 文档/图片选择器；返回 URI，使用前复制进沙盒 |
| `showOpenDialogSync` | 不支持 | 同上 |
| `showSaveDialog` | 受限 | 写入沙盒临时文件后调起分享面板；`defaultPath` 仅作为文件名建议 |
| `showSaveDialogSync` | 不支持 | — |
| `showErrorBox` | 等价 | 映射到 Alert |
| `showCertificateTrustDialog` | 不支持 | 无证书信任链 UI |

## 8. `shell`

| 成员 | 级别 | 说明 |
|---|---|---|
| `openExternal(url, options?)` | 近似 | `Linking.openURL`；`https` `mailto` `tel` 可用；未安装的 scheme reject |
| `openPath(path)` | 受限 | 仅沙盒内文件；用系统 Intent / QuickLook 打开，无关联应用时 reject |
| `showItemInFolder` | 不支持 | 无文件管理器定位 |
| `trashItem` | 受限 | 等价于删除；建议二次确认 |
| `beep()` | 近似 | 触发系统提示音；静音模式下无声 |

## 9. 菜单、托盘、通知

### 9.1 `Menu` / `MenuItem`

- `Menu.buildFromTemplate()` / `Menu.setApplicationMenu()` / `Menu.getApplicationMenu()`：**数据模型可用**，默认不渲染。
- 渲染由 `menu.application` UI 槽或 `window.titleBar` 插件负责。
- `popup()`：需插件映射到 ActionSheet / 长按菜单；基础运行时抛"需插件"错误。
- `role`（`copy` `paste` `undo` 等）：**不自动绑定**。这些 role 操作的是原生文本控件，WebView 内的选区需要 `document.execCommand` 或 `navigator.clipboard` 自行实现。
- `accelerator`：仅在硬件键盘（平板/外接）下有意义，需插件接管。

### 9.2 `Tray`

不支持。替代：

- Android：常驻通知（需 `POST_NOTIFICATIONS` 权限 + 前台服务）；
- iOS：无等价物，改为应用内入口或 Widget。

### 9.3 `Notification`

| 成员 | 级别 | 说明 |
|---|---|---|
| `isSupported()` | 等价 | 取决于是否安装原生通知库 |
| `new Notification({title, body})` | 需原生 | 需 `@notifee/react-native` 或等价库 |
| `show()` | 需原生 | 首次调用触发权限申请 |
| `close()` | 需原生 | Android 可撤销；iOS 需按 id 移除 |
| 事件 `click/close/action` | 需原生 | 点击需带回路由参数（深链） |

## 10. 外观、屏幕、剪贴板、电源

| API | 级别 | 说明 |
|---|---|---|
| `nativeTheme.shouldUseDarkColors` | 等价 | `Appearance.getColorScheme()` |
| `nativeTheme.themeSource` | 受限 | 只能影响应用内渲染；不改系统主题 |
| `nativeTheme.on('updated')` | 等价 | `Appearance` 变化事件 |
| `screen.getPrimaryDisplay()` | 近似 | 返回屏幕尺寸、缩放、安全区 |
| `screen.getAllDisplays()` | 受限 | 恒返回一个 |
| `screen.getCursorScreenPoint()` | 不支持 | 无鼠标坐标 |
| `screen.on('display-metrics-changed')` | 近似 | 旋转/分屏时触发 |
| `clipboard.readText/writeText` | 近似 | 异步；写入需要页面聚焦 |
| `clipboard.readHTML/writeHTML` | 受限 | 平台差异大，Android 支持不完整 |
| `clipboard.readImage/writeImage` | 需原生 | 需图片编解码模块 |
| `powerMonitor.on('suspend'/'resume')` | 受限 | 基于 `AppState`，不区分锁屏与切后台 |
| `powerMonitor.getSystemIdleTime()` | 不支持 | 无系统空闲时间 |

## 11. 网络、会话、协议

| API | 级别 | 说明 |
|---|---|---|
| `net.request(options)` | 受限 | 基于 `fetch`；支持 method/headers/body；不支持自定义 CA、代理、HTTP/2 复用、`redirect: 'manual'` 的完整语义 |
| `net.isOnline()` | 近似 | 基于 `@react-native-community/netinfo` 或原生 |
| `net.resolveHost()` | 不支持 | 无 DNS 解析接口 |
| `session.defaultSession.cookies` | 受限 | 只能读写当前 WebView 可见的 Cookie；HttpOnly 不可读 |
| `session.clearCache()` | 近似 | 调 WebView 清缓存 |
| `session.fromPartition()` | 不支持 | 无独立会话 |
| `protocol.handle()` | 不支持 | 不能注册自定义 scheme；用资源服务 + URL 改写替代 |
| `protocol.isProtocolHandled()` | 近似 | 恒 `false`（除内置资源服务） |

## 12. 进程与端口

| API | 级别 | 说明 |
|---|---|---|
| `utilityProcess.fork()` | 需插件（Android） | 映射到子运行时；iOS 抛错 |
| `utilityProcess.postMessage()` | 需插件 | 消息需可序列化；二进制走分块 |
| `MessageChannelMain` / `MessagePortMain` | 不支持 | 跨进程端口无法在 WebView 边界复现 |
| `child_process.fork`（Node 侧） | 需插件（Android） | 真实 OS 进程 + 独立 bundle（[01](01-architecture.md) §4.3） |
| `child_process.spawn/exec/execFile` | 不支持 | 沙盒内不能执行外部二进制 |

## 13. 明确不支持

| API | 错误信息里的 Fix |
|---|---|
| `globalShortcut.*` | 改为应用内快捷键（硬件键盘监听）或删除该功能 |
| `autoUpdater.*` | 改用 App Store / Google Play / EAS Update / CodePush |
| `desktopCapturer.*` | 改为应用内画面采集（`react-native-view-shot` / 原生录屏） |
| `BrowserView` / `WebContentsView` | 拆成独立窗口，或用 iframe（受同源限制） |
| `WebFrameMain` | 无子框架概念；需要操作 iframe 时用注入脚本 |
| `contentTracing` | 用 RN/原生性能工具 |
| `safeStorage.*` | 装 Keychain/Keystore 插件（`react-native-keychain`） |
| `systemPreferences.getUserDefault` | 无系统偏好数据库 |

## 14. 路径与权限

| 需求 | 做法 |
|---|---|
| 读写应用私有文件 | `app.getPath('userData')` + 异步 `fs` |
| 用户选择文件 | `dialog.showOpenDialog` → 拿到 URI → 复制进沙盒 |
| 导出文件 | 写入沙盒 → `Share.share({ url })` |
| 访问相册 | 原生图片选择器 + 权限声明（`contributes.native`） |
| 后台任务 | Android 前台服务 / iOS BGTask；不要假设 JS 常驻 |

## 15. 给插件作者的契约要求

实现一个 Electron feature 时，必须满足：

1. 导出一个**纯对象或类**，不要在模块顶层做 IO 或改全局。
2. 不支持的成员要抛符合 §1.1 格式的错误，并在 `members.missing` 里声明。
3. 语义有差异的成员在 `members.partial` 里声明，并写进 `resolves.note`。
4. 事件监听返回 `this`，支持链式调用。
5. 不吞异常：捕获后要么转成 rejected Promise，要么打到日志并保留原始堆栈。

## 16. Runtime API（供 shim 与 UI 槽使用）

`@e2rn/runtime` 在 boot 后暴露一个只读单例，插件实现 feature 或 UI 槽时通过它访问运行时能力，**不要**直接 import WindowManager 组件或 store。

```ts
interface RuntimeApi {
  readonly appName: string;
  readonly platform: 'android' | 'ios';
  readonly config: ResolvedConfig;

  // 窗口
  getWindow(id: number): WindowState | undefined;
  listWindows(): WindowState[];

  // 受控 UI（避免插件各自引 UI 库）
  ui: {
    choice(opts: { title: string; message: string; detail?: string; buttons: string[]; cancelId?: number }): Promise<number>;
    confirm(opts: { title: string; message: string }): Promise<boolean>;
    toast(message: string): void;
  };

  // 原生能力（由宿主实现，插件按需声明依赖）
  native: {
    pickFiles(opts: { multiple?: boolean; types?: string[] }): Promise<string[]>;
    share(opts: { url?: string; text?: string; title?: string }): Promise<void>;
    openUrl(url: string): Promise<void>;
  };

  /** 执行脚本并拿回结果（弥补 Android injectJavaScript 不返回值的限制）。 */
  evalWithResult(windowId: number, code: string, timeoutMs?: number): Promise<unknown>;

  /** 为 sendSync 的 snapshot 策略准备数据；窗口创建时推送一次。 */
  syncSnapshot(values: Record<string, unknown>): void;
}
```

| 成员 | 说明 |
|---|---|
| `getWindow/listWindows` | 只读快照；要订阅变化用 `useWindowStore`（UI 槽内部） |
| `ui.choice` | 返回按钮索引；`cancelId` 在点击遮罩/返回键时返回 |
| `native.pickFiles` | 返回沙盒内可读路径；未复制前拿到的是 URI 时由运行时负责复制 |
| `evalWithResult` | 注入 `code` 并等待页面回调；超时 reject。页面禁用脚本时不可用 |
| `syncSnapshot` | 仅 `electron.sendSync === 'snapshot'` 时生效；值必须可 JSON 序列化 |

约束：

- RuntimeApi 只在**运行期**存在；CLI 侧不要 import。
- `native.*` 的能力受 `contributes.native` 影响：没声明依赖时调用会抛"未安装原生模块"。
- 不要缓存 `getWindow` 的返回值当作实时状态；它是快照。

