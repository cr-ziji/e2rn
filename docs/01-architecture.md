# 01 · 架构

> 读完本文，你应该能回答：代码跑在哪几个域里、启动顺序为什么不能变、一条 IPC 消息经过哪些环节、哪些不变量一旦破坏就会全线崩溃。

## 1. 两个时期，三种执行域

转换期（Node 侧，CLI 进程）与运行期（设备侧）严格分开：前者只读源码、产出工程；后者只消费生成物与运行时包。

```text
转换期（Node）                            运行期（设备）

CLI                                     域 A · RN Host（Hermes/JSC，单上下文）
  scan → classify → plan → emit           用户 main 代码
  → verify                                @e2rn/electron（feature 注册表）
                                          @e2rn/polyfills（Node 全局与环境指纹）
只读取 Electron 工程  ── 产物 ──►         EventBus · WindowStore · Bridge
                                                │ postMessage / injectJavaScript
                                                ▼
                                         域 B · WebView（独立 JS 引擎）
                                           用户 index.html / renderer bundle
                                           注入的 preload bundle → __e2rnIpc
                                                ▲
                                         域 C · Child Runtime（可选，仅 Android）
                                           独立 OS 进程 + 独立 Hermes + 独立 bundle
```

| 域 | 引擎 | 承载什么 | 与谁通信 |
|---|---|---|---|
| **A · RN Host** | RN 的 JS 引擎 | 用户主进程、Electron shim、Polyfill、窗口状态 | 域 B（异步消息）、域 C（进程消息）、原生模块 |
| **B · WebView** | WebView 自带引擎 | 用户渲染层、preload bundle | 域 A（异步消息） |
| **C · Child** | 独立 Hermes | 被 `fork` 的子进程入口 | 域 A（LocalSocket，可传二进制） |

**为什么必须强调"三个引擎"**：域 A 与域 B 不是同一个 JS 上下文。任何"共享对象/同步调用"的假设都会错。这是 `sendSync` 无法保真、`contextBridge` 只能近似、`executeJavaScript` 拿不到返回值的根因。

## 2. 文件角色：先分清是谁的代码

同一份工具函数，在主进程里可以 `require('fs')`，在渲染层里不行。因此扫描阶段给每个文件打角色标签，风险规则按角色生效。

```ts
type ProcessRole = 'main' | 'preload' | 'renderer';

interface FileRole {
  filePath: string;
  relativePath: string;
  roles: ProcessRole[];        // 一个文件可同时承担多个角色
  reason:
    | 'main-entry' | 'preload-entry' | 'renderer-entry'
    | 'imported-by-main' | 'imported-by-preload' | 'imported-by-renderer'
    | 'html-script' | 'name-heuristic' | 'unreachable';
}
```

判定顺序（不可调换）：

1. **入口定性**：`package.json#main` → `main`；静态可解析的 `webPreferences.preload` → `preload`（允许多个）；`loadFile()` / `loadURL()` 静态引用与 HTML → `renderer`（允许多个）。
2. **链路传播**：沿相对路径的 `require` / `import` / `import()` / `require.resolve` 做 BFS。三种角色的传播**相互独立**，防止主进程"吃掉"渲染脚本。
3. **HTML 标记**：`<script src>` 解析到的本地文件 → `renderer`。
4. **兜底**：文件名含 `preload` → `preload`；其余标为 `unreachable`，不参与角色相关判定（不误报，也不假装已覆盖）。

> 为什么不用"目录名"判定：真实工程里 `src/main/` 可能放着渲染层共享代码，`shared/` 可能同时被两侧引用。只有引用链路是可信证据。

## 3. 启动序列

`index.js` 的顺序是硬约束。任何一步提前或延后，都会产生"看起来启动了，其实行为错"的问题。

```js
// 生成工程的入口（示意）
require('react-native').LogBox.ignoreAllLogs(true);  // 1
require('./src/runtime/logForwarder').install();      // 2
require('@e2rn/polyfills/register');                  // 3
require('./src/runtime/boot').boot();                 // 4
require('./src/runtime/loadMain').loadUserMain();     // 5
AppRegistry.registerComponent(appName, () => App);    // 6
```

| # | 步骤 | 做什么 | 为什么必须在这 |
|---|---|---|---|
| 1 | 静音 LogBox | 屏蔽预期内的非致命日志 | 转换后的应用会有大量"桌面环境缺失"告警，LogBox 会盖住整个界面 |
| 2 | 日志转发 | 把 `console.*` 送到 logcat / 文件 | 后续所有步骤的失败都必须可见，否则等于黑盒 |
| 3 | 安装 Polyfill | `process`、`Buffer`、`global`、`TextEncoder/Decoder`、`setImmediate`、`navigator` 等 | 用户模块在**求值期**就会探测这些全局，晚一步就 crash |
| 4 | 装配运行时 | 安装环境指纹、Bridge、feature 注册表、`app` 生命周期 | shim 需要注册表；`app.whenReady()` 必须在用户注册监听前就绪 |
| 5 | 加载用户主进程 | `require` 原始入口（动态 require，不能用顶层 import） | 静态 import 会在第 3、4 步之前求值，导致 shim 读到未初始化的全局 |
| 6 | 注册 UI | `AppRegistry` | 必须在主进程启动后，窗口状态才有数据源 |

### 3.1 三条不变量

1. **幂等**：`boot()` 重复调用必须无副作用（开发态热重载会重复执行）。
2. **不抛穿**：用户主进程加载失败不得让整个 App 白屏。捕获后渲染一个诊断页（错误 + 报告路径 + 重试按钮）。
3. **可观测**：每一步打一条带 `[e2rn]` 前缀的结构化日志（阶段、耗时、结果），并在 30s 未完成时输出"卡在哪一步"。

### 3.2 为什么用户入口必须动态加载

```ts
// 正确
export function loadUserMain() {
  return require('../../src/vs/code/electron-main/main');   // 运行时才求值
}

// 错误：ESM 提升会让用户模块在 boot() 之前求值
import '../../src/vs/code/electron-main/main';
```

这条规则对**所有**转换工程成立，不只是大型项目。生成器必须用 `require` 包一层，并在文档里写明原因。

## 4. IPC 的四条路径

### 4.1 renderer → main（send / invoke）

```text
WebView                     Bridge（域 A）                     ipcMain
  │  __e2rnIpc.send/invoke      │                                │
  ├──── postMessage(JSON) ─────►│ decodeWire                     │
  │                             ├─ send  → eventBus.emit ────────►│ listener(event,...args)
  │                             ├─ invoke→ handler(event,...args) │
  │◄─── postMessage(ipc-reply) ─┤◄────────── Promise 结果 ────────┤
```

- `event.sender` 必须是**该窗口的 WebContents 实例**，不能是临时对象。真实工程会调用 `sender.isDestroyed()`、`sender.send()`、`sender.once('destroyed')`。
- `event.senderFrame.url` 故意留空：RN 的 `URL` 解析不支持 `app-file:` 这类自定义 scheme，填错会触发框架的 origin 校验分支。
- `invoke` 的 `requestId` 由渲染侧自增；Bridge 只做转发，不缓存结果。

### 4.2 main → renderer

```text
main: win.webContents.send(channel, ...args)
  → WebContents.send → Bridge.emitRendererEvent(windowId, channel, args)
  → WebView.postMessage({ type:'ipc-event' })
  → preload 分发给 __e2rnIpc.on 的监听器
```

**窗口未加载完成时发送会丢消息**。`WebContents` 需要维护一个发送队列：`did-finish-load` 之前入队，之后 flush。Electron 的语义是"发出去就不管"，但大型桌面应用常在 `loadURL` 后立刻 `send`，必须补这个队列，否则表现为"偶发丢消息"。

### 4.3 main ↔ child（可选）

```text
child.send(msg) → E2RNProcessManager.send(token, JSON)
                → LocalSocket → 子进程 Hermes → process.on('message')
```

- 传输层是**分块的**：单条消息超过 256KB 切块，二进制走 base64 信封（`final` 标记结束）。
- 子进程异常退出要转成 Electron 的 `app.on('child-process-gone')`，否则上层会把崩溃当"静默退出"。

### 4.4 main 内部

同一上下文里，主进程自己的 `EventEmitter`、`ipcMain.emit` 都是普通调用，不经过 Bridge。不要为了"统一"给内部调用加序列化。

## 5. 窗口模型

```ts
interface WindowState {
  id: number;                 // 与 BrowserWindow.id 一致
  bounds: { x: number; y: number; width: number; height: number };
  visible: boolean;
  focused: boolean;
  minimized: boolean;
  maximized: boolean;
  fullscreen: boolean;
  showTitleBar: boolean;
  title: string;
  url?: string;               // loadURL
  file?: string;              // loadFile
  loading: boolean;
  reloadNonce: number;        // 每次 loadURL/reload 自增，作为 WebView key 强制重挂载
  parentId?: number;
  additionalArguments?: string[];
}
```

三个实现要点：

1. **窗口即数据**。`BrowserWindow` 实例只持有 `id` 与少量同步缓存，真实状态在 `WindowStore`（Zustand 或等价物）。这样 UI 与主进程都能读同一份状态，不需要双向同步。
2. **重挂载而非改 source**。同一个 URL 再次 `loadURL` 时，仅改 `url` 不会触发导航；必须靠 `reloadNonce` 变更 `key`。这是真实工程里"点第二次打不开"的根因。
3. **卸载要彻底**。窗口关闭时注销 `webviewRegistry`、`webContentsRegistry`、事件监听与未完成的 invoke。否则内存泄漏会随窗口开关线性增长。

窗口模式（详见 [07-renderer.md](07-renderer.md)）：

| 模式 | 说明 | 默认 |
|---|---|---|
| `fullscreen` | 一个窗口铺满（含安全区），系统返回键 = 关闭/回退 | 是 |
| `stack` | 多窗口卡片纵向堆叠，可切换焦点（平板） | 否 |
| `desktop` | 自由拖拽/缩放（≥ 10 吋设备） | 否 |

## 6. Bridge 契约

Bridge 是 shim 与 UI 之间唯一的通道，挂在 `globalThis.__E2RN_BRIDGE__`。shim 不得直接 import React 组件。

```ts
interface E2RNBridge {
  // 窗口
  createWindow(options: CreateWindowOptions): number;
  destroyWindow(id: number): void;
  showWindow(id): void; hideWindow(id): void; focusWindow(id): void;
  minimizeWindow(id): void; maximizeWindow(id): void; restoreWindow(id): void;
  setBounds(id, bounds: Partial<Bounds>): void;
  getBounds(id): Bounds;
  setTitle(id, title: string): void;

  // 内容
  loadURL(id, url: string): Promise<void>;
  loadFile(id, file: string): Promise<void>;
  reloadWindow(id): void;
  sendToWeb(id, channel: string, ...args: unknown[]): void;
  executeJavaScript(id, code: string): Promise<unknown>;

  // 渲染侧回调
  onRendererMessage(windowId: number, raw: string): void;
  notifyDidStartLoading(id): void;
  notifyDidFinishLoad(id): void;

  listWindows(): WindowState[];
}
```

约束：

- 所有方法**同步返回**（除加载类），内部状态变更走 store，UI 异步响应。
- 任何抛出都要在 shim 层转成 `Error`，不能让异常穿过 React 渲染。
- Bridge 是内部契约，不承诺跨版本稳定；插件应使用 `contributes`，不要直接调 Bridge。

## 7. 数据编码（wire）

WebView 只能传字符串，但真实工程的 IPC 会传二进制（`VSBuffer`、protobuf、图片）。

```ts
// 信封
{ "__e2rn": true, "type": "ipc-invoke", "channel": "x", "args": [...], "requestId": 1 }

// 二进制编码
ArrayBuffer      → { "__e2rnAB": "<base64>" }
TypedArray/View  → { "__e2rnTA": "<base64>" }
Buffer.toJSON()  → { type:"Buffer", data:[...] }  // 必须在 replacer 里折回 base64
```

三个坑：

1. `JSON.stringify` 会先调 `toJSON()` 再调 replacer，`Buffer#toJSON` 产出的是 `{type:'Buffer',data:[…]}`，不是 `ArrayBuffer`。不特殊处理，二进制会被解成数字对象。
2. 反序列化要还原成**真正的 `Buffer`**（若全局存在），否则 `Buffer.isBuffer()` 判断为 false，上层会走错分支。
3. 单条消息建议 ≤ 1MB；大文件走资源服务或分块，不要塞进 IPC。

## 8. 生命周期映射

| Electron | E2RN | 差异 |
|---|---|---|
| `app.whenReady()` | RN 根组件挂载前 resolve | 早于 `AppRegistry`，便于主进程先建窗口 |
| `app.on('ready')` | `whenReady` 后 microtask 派发一次 | 在 ready 之后注册的监听器不会再触发（与 Electron 一致） |
| `app.on('activate')` | App 回到前台（`AppState: active`） | iOS/Android 都有；不带 `hasVisibleWindows` 语义 |
| `app.on('window-all-closed')` | 最后一个窗口关闭 | **不自动退出**：移动端没有"关掉所有窗口就退进程"的概念 |
| `app.on('before-quit')` | 用户主动退出 / 系统回收前 | 不保证执行完；异步清理要有超时 |
| `app.quit()` | 关闭所有窗口 + 触发 quit 事件 | iOS 上不允许程序化退出，降级为"回到桌面" |
| `app.requestSingleInstanceLock()` | 恒返回 `true` | 单实例是移动端默认；`second-instance` 永不触发 |

**不要在移动端假设进程常驻**。后台挂起后 JS 线程会停；恢复时可能已过很久。长连接、定时任务、文件监听都要按"会断"来设计（见 [08-limitations.md](08-limitations.md)）。

## 9. 失败与降级策略

| 失败点 | 行为 | 上报 |
|---|---|---|
| 某个 Polyfill 缺失 | 该模块的调用点抛错，其余功能继续 | `builtin.*` finding |
| Electron API 未实现 | 访问时抛 `[e2rn] xxx is not supported`，附替代建议 | `electron-api.*` |
| 用户主进程加载失败 | 停在诊断页，保留 App 壳与日志 | 启动日志 + `verify.json` |
| 窗口加载失败 | 窗口显示错误页 + 重试，不影响其它窗口 | `renderer.load-failed` |
| 子进程崩溃 | 触发 `child-process-gone`，由上层决定重启 | 进程日志 |

原则：**局部失败不升级为全局失败**；但**能力缺失不得静默**。
