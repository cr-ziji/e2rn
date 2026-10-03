# E2RN - Electron to React Native 转换工具

> 名称：`e2rn`（Electron To React Native）
> 定位：开源的 CLI 转换工具，目标是在**不修改用户 Electron 源代码**的前提下，自动生成一个可直接运行的 React Native 应用，使 Electron 项目能够平滑过渡到移动端。

## 1. 项目概述

### 1.1 背景与痛点

Electron 应用在桌面端开发体验极佳，但无法直接运行在 iOS/Android 上。传统迁移方案（Capacitor、Tauri 等）往往需要大幅改动主进程逻辑。

早期尝试的 `e2c` 方案采用了 `nodejs-mobile` 将主进程运行在独立的 Node 线程中。实测发现该思路在移动端存在以下致命问题：

- **包体积暴增**：需要额外内嵌 Node 二进制，导致 APK/IPA 体积显著变大
- **原生模块支持并未改善**：`.node` 原生模块仍然需要针对 Android（CMake/NDK）和 iOS（Xcode）分别适配、编译，根本无法“自动”迁移
- **通信开销过大**：独立 Node 进程与 React Native JS 之间需要跨进程/跨线程桥接，IPC 延迟远高于同一 JS 上下文内的函数调用，界面响应变得十分卡顿
- **部分核心模块天然不支持**：`child_process`、`cluster`、`worker_threads` 等在 `nodejs-mobile` 环境下要么完全不可用，要么行为大幅受限
- **运行速度拖慢**：额外的序列化、消息传递和线程切换，大幅降低了原本纯 JS 业务逻辑的执行效率

### 1.2 项目目标

E2RN 的核心目标是：**用最轻、最直接、最高效的方式，让 Electron 主进程代码跑起来**。

具体目标如下：

1. **非侵入式转换**：尽可能不修改用户原始的 Electron 源代码（`main`、`preload`、`renderer`），通过适配层、Shim、模块映射实现兼容。
2. **直接用 RN 内置 JS 引擎运行主进程**：放弃独立 Node 进程，改为**将 Electron 主进程代码直接打包进 React Native 的 JS Bundle**，并在 Hermes/JSC 中执行。绝大多数 Electron 主进程逻辑本质上都是纯 Node.js/JS 代码，完全可以在 RN 的 JS 引擎中运行。
3. **桌面窗口模拟**：在 React Native 中使用 `react-native-webview` 搭配自研 `WindowManager`，模拟 `BrowserWindow` 的多窗口、标题栏、尺寸、位置、聚焦、最小化/最大化/关闭等行为。
4. **自研 `electron` Shim 包**：实现 `@e2rn/electron` 运行时替身，将 `app`、`BrowserWindow`、`ipcMain`、`ipcRenderer`、`dialog`、`shell`、`Menu`、`Notification` 等常用 Electron API 映射到 React Native 能力。
5. **Node 内置模块 Polyfill**：针对 `fs`、`path`、`crypto`、`os`、`events`、`stream`、`util`、`buffer`、`url`、`timers` 等常用 Node 内置模块，优先采用成熟方案（如 `node-stdlib`、`unenv`）按需注入。对于确实无法在纯 JS 环境中实现的模块（如 `child_process`）则**不伪造**，直接在检测报告中明确提示用户替换思路。
6. **动态引入与原生模块可控处理**：通过静态 AST 扫描识别动态 `require/import`、`.node` 原生模块、C++ Addon。对于这些场景，工具不会盲目替换，而是生成清晰的可行性报告和迁移建议，引导社区插件或用户手动适配。
7. **插件化生态**：核心保持轻量，所有 API 映射、Polyfill 策略、窗口 UI 均通过插件系统扩展，鼓励社区共建。
8. **极简运行时开销**：采用同一 JS 上下文（RN JS）运行主进程逻辑，省去跨线程/跨进程通信、序列化、进程启动等开销，恢复 Electron 项目原本应有的响应速度。

### 1.3 核心设计原则

| 原则 | 说明 |
|---|---|
| **In-Process（同进程同引擎）** | 主进程代码直接运行在 RN 内置 JS 引擎中，而非独立 Node 进程。减少通信开销、包体积和复杂度。 |
| **最小改动（Non-Intrusive）** | 尽量不改动用户的 Electron 源代码。用户业务逻辑是唯一事实源。 |
| **诚实面对平台差异（Explicit over Hidden）** | 对于移动端无法实现的能力（如 `child_process`、系统级原生 Addon、全局快捷键等），**显式标注**而不是静默降级。 |
| **按需注入（Scan-Driven）** | 基于静态扫描结果，仅注入真正用到的 Node 内置模块 Polyfill 和 Electron API Shim，避免无用依赖。 |
| **运行时轻量（Avoid Unnecessary Overhead）** | 拒绝为“理论上的通用性”引入额外进程。优先选择“够用且快”的方案。 |
| **渐进式兼容（Progressive Compatibility）** | 先覆盖高频 API，通过 `e2rn check` 输出清晰的兼容度、风险点和未覆盖项。 |

---

## 2. 整体架构设计

### 2.1 架构概览

E2RN 分为 **转换时（CLI）** 和 **运行时（RN App）** 两部分。

```text
┌─────────────────────────────────────────────────────────────┐
│                        CLI 层（Command Layer）                │
│  e2rn init | check | convert | config | plugin | doctor     │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    转换引擎（Conversion Engine）              │
│  Analyzer · Scanner · Transformer · ModuleMapper · Scaffold │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                     运行时（Generated RN App）               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐   │
│  │  WebView #1  │  │ WindowManager│  │  In-Process Main    │   │
│  │  (Renderer)  │  │ 多窗口容器   │  │  (RN JS Engine)     │   │
│  └─────────────┘  └─────────────┘  │  - 用户 main.js/ts  │   │
│                                   │  - @e2rn/electron   │   │
│                                   │  - Node Polyfills   │   │
│                                   └─────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                        WebView <-> RN Bridge（postMessage）
                            │
                        RN EventBus（ipcMain <-> ipcRenderer）
```

### 2.2 运行时模型：In-Process 主进程

与 Electron 的双进程模型不同，E2RN 采用 **“单应用上下文 + 双视图角色”** 的方式：

| 角色 | 对应 Electron | E2RN 实现 | 说明 |
|---|---|---|---|
| **主进程（Main）** | `main.js/ts`，运行在 Node.js | **直接运行在 RN JS 引擎（Hermes/JSC）** | 将用户主进程代码整体打包进 RN JS Bundle。在 RN 应用启动时，由 `E2RN Main Entry` 加载并初始化（等同于 Electron 的 `app.whenReady()` 流程）。 |
| **渲染进程（Renderer）** | Chromium 渲染 | `react-native-webview` | 每个 `BrowserWindow` 实例对应一个 WebView 容器。用户的 `index.html`、渲染逻辑、`preload` 脚本均在 WebView 内运行。 |
| **Preload** | 安全桥接层 | 原样保留 | 尽量保留用户原始 `preload.js/ts` 内容。通过注入的最小 Bridge 脚本配合 `contextBridge` 恢复 `ipcRenderer` 语义。 |
| **IPC** | `ipcMain` <-> `ipcRenderer` | **同一 JS 事件总线** | 由于 Main 和 Bridge 都运行在同一个 RN JS 上下文中，无需跨进程通信。`ipcRenderer`（WebView）通过 `postMessage` 发消息到 RN，再直接分发给 `ipcMain` Shim；反向亦然。省去了 nodejs-mobile 的线程/进程间序列化开销。 |

### 2.3 为什么选用 In-Process 而非 nodejs-mobile

| 对比维度 | **In-Process（E2RN 本方案）** | **nodejs-mobile（e2c 思路）** |
|---|---|---|
| **包体积** | 更小。仅需 JS Polyfill，无需内嵌整套 Node 二进制。 | 较大。需打包 `libnode.so`（Android）和 Node 二进制（iOS），通常多出 20~40MB。 |
| **运行性能** | 更快。Main 与 RN、Bridge 同属一个 JS 引擎上下文，函数调用零跨进程开销。 | 较慢。跨线程/跨进程通信频繁时，JSON/序列化、事件循环切换会带来明显延迟。实测（e2c）体验卡顿。 |
| **原生模块（.node）** | **并未“免费”获得**。仍需为双平台重新构建。且大多数面向桌面编译的 `.node` 并不直接适配移动端。E2RN 干脆**不强行处理**，改为检测+提示+社区插件引导。 | 理论上能加载预编译 `.node`，但现实中可直接复用的极少。移植成本几乎等同 In-Process 场景。 |
| **`child_process` 等模块** | 明确不支持，报告中列出替代方案（如下载改用 `react-native-blob-util`、后台任务用原生能力等）。 | 同样不支持或极度受限。伪造毫无意义。 |
| **集成复杂度** | 更低。纯 JS 打包，不涉及复杂的原生 Node 集成、线程管理、崩溃隔离等。 | 更高。需要配置 `nodejs-mobile-react-native` 原生依赖、`nodejs-assets`、Android NDK、iOS 构建配置，排障难度大。 |
| **调试体验** | 更顺。可直接用 Chrome/Flipper 调试 RN JS（含主进程逻辑），断点、堆栈、日志都在同一上下文。 | 较繁琐。需分别调试 RN 和 Node 侧，跨进程断点追踪更麻烦。 |

**结论：对于绝大多数 Electron 应用而言，In-Process 方案在“移动端可用性、性能、体积、可维护性”上都优于 nodejs-mobile。E2RN 因此放弃 nodejs-mobile，转向 In-Process 路线。**

---

## 3. 技术选型

| 技术 | 用途 | 说明 |
|---|---|---|
| **TypeScript** | CLI + 生成代码 | 类型安全，便于插件系统接口约束。 |
| **cac** | CLI 框架 | 轻量、简洁的命令行解析。 |
| **SWC** | AST 转换 | 高性能，适合批量转换主进程、preload 代码。 |
| **ts-morph** | 精准 AST 分析 | 用于复杂语义扫描（动态 require、API 调用链、sendSync 定位）。 |
| **unenv / node-stdlib** | Node 内置模块 Polyfill 基础 | 社区成熟的“Node → JS”映射，支持按环境裁剪，避免全量引入。 |
| **react-native-webview** | 渲染容器 | 模拟 Electron 的 Chromium 渲染进程。 |
| **react-native-gesture-handler + react-native-reanimated** | 窗口拖拽/缩放 | 用于实现桌面风格窗口交互。 |
| **ejs** | 模板引擎 | 生成 RN 骨架、Bridge 脚本、Loader 等文件。 |

> **Node Runtime Host 概念替换**：原设计中的 `Node Runtime Host（nodejs-mobile）` 全部替换为 **`In-Process Main Runtime（RN JS Engine）`**。

---

## 4. CLI 命令设计

沿用简洁的命令风格，命名为 `e2rn`。

| 命令 | 功能 | 说明 |
|---|---|---|
| `e2rn init` | 初始化配置向导 | 交互式生成 `e2rn.config.ts/js`，配置 Electron 路径、输出目录、应用名、Bundle ID 等。 |
| `e2rn check` | 转换可行性检测 | 静态扫描主进程/Preload/Renderer，识别 Electron API、Node 内置模块、动态引入、原生模块，输出 `e2rn-compatibility-report.md/.json`。 |
| `e2rn convert` | 执行转换 | 按阶段生成 RN 项目：骨架、主进程打包、模块映射、Electron Shim、WindowManager、Bridge 等。 |
| `e2rn config` | 配置管理 | `get/set/list/reset/delete`，支持项目配置和全局配置。 |
| `e2rn plugin` | 插件管理 | `list/info/enable/disable/search/install/uninstall`，用于扩展 API 映射、Polyfill 等。 |
| `e2rn doctor` | 环境诊断 | 检查 Node、npm/yarn/pnpm、React Native 开发环境（Android SDK/Xcode/CocoaPods）等是否就绪。 |

---

## 5. 转换流程（Stages）

| 阶段 | 名称 | 任务 |
|---|---|---|
| **0. preflight** | 前置校验 | 校验配置、路径、环境。可选自动执行 `check`。 |
| **1. analyze** | 项目分析 | 扫描 Electron 项目结构：`package.json`、`main` 入口、`preload`、renderer 入口、相关文件。 |
| **2. compat-check** | 可行性检测 | 生成兼容性报告。若存在高风险项（如原生 Addon、无法 Polyfill 的内置模块）且未加 `--force`，则中断并提示。 |
| **3. scaffold** | RN 骨架生成 | 基于模板创建 Bare RN 项目骨架：`android/`、`ios/`、`src/`、`index.js`、`package.json` 等。 |
| **4. bundle-main** | 主进程打包准备 | 将用户 `main` 相关源码复制到生成项目的 `src/main/`（或 `src/e2rn-main/`），保留目录结构，便于打包进 RN JS Bundle。 |
| **5. transform** | 代码转换 | 对主进程、Preload 执行 AST 转换：模块映射（`require('electron')` → `@e2rn/electron`）、路径处理、`process.versions.electron` 替换、`ipcRenderer.sendSync` 语义适配等。 |
| **6. generate-shim** | 生成 Electron Shim | 根据扫描到的 API 清单，按需生成 `@e2rn/electron` 运行时代码（`app`、`ipcMain`、`BrowserWindow`、`dialog` 等子模块），而非全量 Stub。 |
| **7. inject-polyfills** | 注入 Node Polyfill | 根据 `builtinsUsed` 清单，按需注入 Node 内置模块 Polyfill。通过别名映射（module-resolver）或运行时注入方式，使 `require('fs')` 等能正确解析。 |
| **8. build-runtime** | 运行时组件生成 | 生成 `WindowManager`、`E2RNBridge`、`E2RNMainBootstrap` 等。`E2RNMainBootstrap` 负责在 RN 应用启动时（`AppRegistry.registerComponent` 后）加载并执行用户主进程代码。 |
| **9. adapt-deps** | 依赖适配 | 更新生成项目的 `package.json`：移除 `electron`、`electron-builder`、`electron-forge` 等桌面端专用依赖；新增 `react-native-webview`、`react-native-gesture-handler`、`react-native-reanimated`、选用的 Polyfill 包以及 `@e2rn/electron`。 |
| **10. post-process** | 补充文档与清单 | 生成 `MIGRATION_GUIDE.md`、`E2RN_TODOS.md`，列出动态引入、原生模块、受限 API、平台差异等待处理项。 |
| **11. summarize** | 总结输出 | 输出文件数、API 覆盖率、风险统计、耗时等人性化总结。 |

---

## 6. Node 内置模块与动态引入处理

### 6.1 Polyfill 策略

| 模块 | 策略 | 说明 |
|---|---|---|
| `path`、`util`、`events`、`buffer`、`timers`、`stream`、`assert`、`url`、`querystring` | **直接 Polyfill** | 纯 JS 实现，行为与 Node 基本一致。首选 `unenv` 或 `node-stdlib` 的精简版。 |
| `fs` | **映射到 RN FS** | 建议映射到 `react-native-fs`（或 `expo-file-system`）。但需注意沙盒路径（Documents/Caches/Temporary）、权限（Android Scoped Storage）等移动端限制。 |
| `os` | **部分实现** | 仅实现常用字段：`platform`、`arch`、`tmpdir`、`homedir`、`endianness`、`EOL`。复杂系统信息按平台差异降级。 |
| `crypto` | **优先原生可用** | Hermes/JSC 环境下可用 `crypto.subtle`（Web Crypto）。对于旧 API（`crypto.createHash` 等）使用 `react-native-quick-crypto` 或 `crypto-browserify` 等替代。按需选用，避免全量引入。 |
| `http`、`https`、`zlib`、`net` | **谨慎 Polyfill** | 可用浏览器化实现（`stream-http`、`https-browserify`、`browserify-zlib`），但证书校验、代理、Keep-Alive、HTTP/2 等与原生 Node 差异较大。仅在检测到实际使用时才提示并注入。 |
| `child_process`、`cluster`、`worker_threads`、`vm`、`dgram`、`tty`、`repl`、`inspector` | **不 Polyfill** | 移动端沙盒、后台限制、无等价系统进程概念。E2RN 不会伪造这些能力。`check` 报告中标记为**高风险/不支持**，并给出替代思路（原生模块、WorkManager、后台任务、纯 JS 重写等）。 |
| `.node`（原生 Addon） | **不自动迁移** | 需要 C++ 源码重新为 Android/iOS 构建。自动化几乎不可能。检测到即在报告中明确列出文件路径，并建议：寻找纯 JS 替代、移植为 React Native Native Module、或通过社区插件实现。 |

### 6.2 动态 `require` 处理

静态 AST 无法穷尽所有动态引入：

```js
const mod = process.platform === 'win32' ? './win' : './unix';
require(mod); // 动态
require(`./plugins/${name}`); // 模板字符串
```

处理方式：

1. **识别**：使用 `ts-morph`/`SWC` 检测 `require()` 参数是否为字面量字符串。非字面量一律归为 `dynamicRequires`。
2. **保守推断**：仅对极简单的常量拼接做最保守推断，其余一律视为“不可静态解析”。
3. **显式暴露**：在 `e2rn-compatibility-report.md` 的「动态引入清单」中列出：文件路径、行号、代码片段、可能涉及的模块。
4. **生成 TODO**：同步写入 `E2RN_TODOS.md`，提示用户手动评估影响范围。必要时可通过自定义 `module-mapper` 插件显式映射。
5. **不强行替换**：不根据猜测注入 Polyfill，避免误导。

---

## 7. Electron API 映射设计

核心思想：**语义尽量对齐，行为差异必须透明**。

| Electron API | 映射方式 | 兼容度 | 备注 |
|---|---|---|---|
| `app` | `@e2rn/electron/app`（In-Process） | ★★★★☆（高） | 生命周期（`ready`、`activate`、`window-all-closed`、`before-quit`、`will-quit`）在 RN 启动流程中模拟。`getPath()` 映射到 RN 沙盒目录（Documents/Caches/Library）。`isPackaged` 根据构建环境判断。 |
| `BrowserWindow` | WindowManager（RN 侧） + Node 端状态模型 | ★★★★☆ | 每个实例维护窗口状态（id、bounds、visible、focused、parent 等），通过 Bridge 驱动 WebView 容器。支持 `show/hide/focus/close/minimize/maximize/restore`、`setSize/setPosition` 等常用方法。 |
| `webContents` | 仿真对象（Main 侧） | ★★★★☆ | `send()` → 向对应 WebView 发送消息。`executeJavaScript()` → `WebView.injectJavaScript()`（返回 Promise）。`openDevTools` 在移动端受限，建议使用远程调试替代。 |
| `ipcMain` | `@e2rn/electron/ipcMain`（In-Process） | ★★★★★ | 直接注册在同一 JS 事件总线，支持 `on/once/removeListener/handle/removeHandler`。`event.reply` 通过 `correlationId` 实现。 |
| `ipcRenderer` | WebView 侧 Shim（注入） | ★★★★★ | 通过 `window.ReactNativeWebView.postMessage` 封装。保留 Preload 原逻辑的前提下注入最小桥接。 |
| `contextBridge` | 原样保留 | ★★★★★ | 不做改动，尊重 Electron 的安全暴露模型。 |
| `dialog` | 映射到 RN 原生交互 | ★★★★☆ | `showMessageBox`→Alert、`showErrorBox`→Alert、`showOpenDialog`→文档/图片选择器（`react-native-document-picker`、`react-native-image-picker`）。`showSaveDialog` 移动端语义差异大，报告中标注限制。 |
| `shell` | `Linking` 映射 | ★★★★☆ | `openExternal(url)` → `Linking.openURL`。`openPath` 受沙盒限制，常需配合文件分享或第三方 App 打开。`showItemInFolder` 多数移动端场景下无等价能力，标记为受限。 |
| `Menu` / `MenuItem` | 可选模拟（Window UI 插件） | ★★☆☆☆ | 系统菜单在移动端并无对应概念。默认不渲染。可通过标题栏“⋮”下拉等自定义 UI 插件模拟，按需启用。 |
| `Tray` | 受限（建议替代） | ★☆☆☆☆ | Android 通知栏可类比，但 iOS 无系统托盘。强烈建议改用本地通知（`react-native-notifications`）或快捷方式等移动端原生方案。 |
| `Notification` | 本地通知映射 | ★★★★☆ | 映射到 `react-native-push-notification`、`@notifee/react-native` 等成熟库。需处理 Android 通知渠道、iOS 权限申请。 |
| `nativeTheme` | `Appearance` 映射 | ★★★★★ | `shouldUseDarkColors`、`themeSource` 映射到 `react-native/Libraries/Utilities/Appearance`。 |
| `screen` | `Dimensions` + 设备信息 | ★★★★☆ | 映射到屏幕尺寸、DPI、方向等。多显示器概念在移动端基本不存在，统一映射为主屏。 |
| `powerMonitor` | 部分映射（插件） | ★★☆☆☆ | 锁屏、唤醒、低电量等事件在 Android 较可行，iOS 限制较多。按需通过原生插件实现。 |
| `globalShortcut` | **不支持** | ☆☆☆☆☆ | 移动端无键盘全局捕获的通用场景。检测到使用直接在报告中标注“不支持”。 |
| `autoUpdater` | **语义不同（不直接映射）** | ☆☆☆☆☆ | 桌面自动更新（electron-updater）与移动端（App Store、Google Play、EAS Update、CodePush）完全不同。E2RN 建议用户迁移到移动端 OTA 方案，而非强行映射 API。 |

### 7.1 `ipcRenderer.sendSync` 处理

`sendSync` 是同步阻塞调用。在**同一 JS 上下文**下理论上也能“同步”返回，但为了最大程度贴合 Electron 语义且避免误导，E2RN 仍采用**显式语义转换**的策略：

| 策略 | 行为 | 说明 |
|---|---|---|
| **`async-promise`（默认）** | 转换为 `async/await` 返回 `Promise` | AST 自动重写：`const val = ipcRenderer.sendSync('x', ...args)` → `const val = await ipcRenderer.invoke('x', ...args)`（并视函数上下文补充 `async`）。这是最安全的方式，避免将异步本质掩盖为同步。 |
| **`warn`** | 运行时警告并返回 `undefined` | 调试阶段使用。提醒开发者该 API 原本是同步的，移动端环境下已失去阻塞语义。 |
| **`throw`** | 直接抛出错误 | 强制用户重构为 `invoke/send+on`，适合追求“零语义妥协”的项目。 |

无论哪种策略，`e2rn check` 都会**完整列出所有 `sendSync` 调用点**（文件、行号、上下文），并在 `MIGRATION_GUIDE.md` 中给出重构建议。

---

## 8. 窗口模拟（WindowManager）

`WindowManager` 是 RN 侧的核心组件，用于模拟 Electron 的 `BrowserWindow`。

### 8.1 设计思路

- **窗口 = 容器**：每个窗口实例对应一个 `Animated.View` + `react-native-webview`。
- **状态集中管理**：使用 React Context 或 Zustand 维护 `windows` Map（`id -> WindowState`），包含 `x,y,width,height,visible,focused,zIndex,resizable,movable,frame,showTitleBar` 等。
- **标题栏模拟**：可选渲染自研 `WindowTitleBar`，支持“最小化/最大化/还原/关闭”按钮、拖拽区域、标题文本。
- **拖拽与缩放**：基于 `react-native-gesture-handler` 的 `PanGestureHandler` 实现窗口拖拽；结合 `reanimated` 实现平滑动画。resize 手柄可后续通过插件扩展。
- **焦点管理**：点击窗口置顶并设为 `focused`，模拟 Electron 的窗口焦点链。
- **多窗口层级**：通过 `zIndex` 动态计算，激活窗口始终置顶。
- **父子窗口**：支持 `parent` 关联，子窗口位置相对于父窗口等基础语义。

### 8.2 窗口模式

考虑到移动端本身是“全屏为主”的交互环境，提供多种模式以平衡“桌面模拟”与“原生体验”：

| 模式 | 值 | 说明 |
|---|---|---|
| **桌面模拟（默认）** | `desktop` | 以窗口卡片形式呈现（可拖拽、可关闭），适合保留原 Electron UI 布局的应用。 |
| **全屏模式** | `fullscreen` | 每个窗口直接铺满屏幕，常用于单窗口应用或转向“页面路由”体验。 |
| **原生模式** | `native` | 更贴近移动端习惯。可结合 React Navigation 将“窗口”映射为 `Screen`，由用户按需选用（通过 Template 插件定制）。 |

配置项：`electron.browserWindowDefaults.windowMode`。

---

## 9. 插件系统

E2RN 采用“Hook + Capability”插件架构。核心轻量，扩展全交给插件。

### 9.1 插件类型

| 类型 | `type` | 职责 |
|---|---|---|
| `runtime-engine` | （已废弃） | **不再使用**。原计划用于 nodejs-mobile，现统一采用 In-Process，不保留此类型。 |
| `electron-api` | `electron-api` | 补全特定 Electron API（`dialog`、`shell`、`Menu`、`Notification`、`screen`、`powerMonitor` 等）的运行时实现。 |
| `builtin-polyfill` | `builtin-polyfill` | 提供 Node 内置模块 Polyfill（`fs`、`crypto`、`http` 等），可自定义映射、限制说明。 |
| `module-mapper` | `module-mapper` | 自定义 `require/import` 映射规则，用于替换第三方包、处理特殊路径等。 |
| `content-transform` | `content-transform` | AST 或字符串转换钩子（`beforeCopy/astTransform/onTransform/afterTransform`），可处理框架特定适配。 |
| `template` | `template` | 自定义 RN 项目模板（文件结构、原生配置片段、`App.tsx` 定制等）。 |
| `window-ui` | `window-ui` | 自定义窗口标题栏、控制按钮、窗口皮肤（仿 macOS/Windows）。 |
| `post-process` | `post-process` | 转换完成后的后处理：生成额外文档、校验清单、依赖建议等。 |

### 9.2 插件基础接口（节选）

```typescript
export type PluginType =
  | 'electron-api'
  | 'builtin-polyfill'
  | 'module-mapper'
  | 'content-transform'
  | 'template'
  | 'window-ui'
  | 'post-process'
  | 'runtime-extension';

export interface E2RNPlugin {
  name: string;
  type: PluginType;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  enabled?: boolean;
  priority?: number;
  dependsOn?: string[];
  conflictsWith?: string[];
  requires?: {
    platforms?: ('android' | 'ios')[];
    rnVersion?: string;
    hermes?: boolean;
    e2rnVersion?: string;
  };
  checkViable?: Record<string, boolean | { solved: boolean; message: string; severity?: 'info'|'warn'|'error' }>;
}
```

---

## 10. 社区贡献

E2RN 鼓励社区通过插件补全 API 覆盖。贡献流程简要如下：

1. **提案**：在仓库新建 Issue，说明要补全的 Electron API、预期实现思路、受限点。
2. **开发插件**：遵循插件接口，提供最小可复现的 Electron 示例用于验证。
3. **本地验证**：使用 `npm link` 链接插件，执行 `e2rn check` 和 `e2rn convert --dry-run` 确认无误。
4. **发布**：将插件发布到 npm，命名建议 `e2rn-plugin-<name>`。
5. **登记**：向 Plugin Registry 提交 PR，补充插件元数据。

### 10.1 插件开发最小示例（`dialog`）

```typescript
// packages/example-plugin-dialog/src/index.ts
import type { ElectronApiPlugin } from '@e2rn/types';

export default {
  name: 'e2rn-plugin-dialog',
  type: 'electron-api',
  version: '0.1.0',
  apiName: 'dialog',
  exportPaths: ['electron.dialog'],
  implementation: {
    renderer: './renderer.js',
    main: './main.js', // 部分 dialog 方法也可在 Main 侧调用
  },
  capabilities: ['showMessageBox', 'showOpenDialog'],
  checkViable: {
    showSaveDialog: { solved: false, message: '移动端无通用“另存为”路径，建议改用分享或文件选择器', severity: 'warn' },
  },
} satisfies ElectronApiPlugin;
```

---

## 11. 编写步骤（Implementation Plan）

重点是**去除 nodejs-mobile 相关全部逻辑**，转向 In-Process。

| 阶段 | 内容 | 状态 |
|---|---|---|
| **Phase 0：基建** | Monorepo（pnpm+turbo）、TypeScript、ESLint、Vitest、构建配置。 | 待开始 |
| **Phase 1：CLI 骨架** | `cac` 命令注册（init/check/convert/config/plugin/doctor）、Logger、Config 加载。 | 待开始 |
| **Phase 2：静态分析** | `@swc/core` + `ts-morph` 实现 Scanner：识别 Electron API、Node builtins、动态 require、原生模块、sendSync。生成兼容性报告。 | 待开始 |
| **Phase 3：RN 模板** | Bare RN 默认模板，包含基础目录结构、`index.js`、`App.tsx`。 | 待开始 |
| **Phase 4：In-Process Main Runtime** | 设计 `E2RNMainBootstrap`：在 RN 启动时加载用户主进程代码。实现主进程打包策略（直接纳入 RN Bundle）。 | **核心** |
| **Phase 5：Transform Engine** | 模块映射、AST 转换、路径适配、sendSync 重写。 | 待开始 |
| **Phase 6：Node Polyfills** | 基于 `unenv/node-stdlib` 按需注入基础内置模块，`fs/os/crypto` 的 RN 映射。 | 待开始 |
| **Phase 7：Electron Shim（In-Process）** | 实现 `@e2rn/electron`：`app`、`ipcMain`、`ipcRenderer`、`BrowserWindow`、`webContents`。基于同一 EventBus 的 IPC。 | **核心** |
| **Phase 8：WindowManager + Bridge** | WebView 注入 Bridge、WindowManager 组件、多窗口状态管理、拖拽交互。 | 待开始 |
| **Phase 9：convert 主流程打通** | 串联全部 Stage，依赖适配，生成 `MIGRATION_GUIDE.md`、`E2RN_TODOS.md`。 | 待开始 |
| **Phase 10：测试与示例** | 最小 Electron 示例（纯 JS 主进程 + 简单 IPC + Preload）端到端验证：`check -> convert -> run-ios/android` 可正常跑起来。 | 验证闭环 |
| **Phase 11：文档完善** | 更新 README、CONTRIBUTING、插件开发指南、API 覆盖矩阵。 | 收尾 |

**里程碑：v0.1.0-beta 的目标是“最小示例能成功转换并在真机/模拟器上运行主进程逻辑 + WebView 渲染”。**

---

## 12. 风险与限制

| 风险/限制 | 严重度 | 说明 | 应对 |
|---|---|---|---|
| **原生 Addon（.node）** | 高 | 无法自动移植 C++ 到 RN 原生。 | 检测即报出，明确列出文件并给出替代建议（纯 JS/WASM/原生 Module 重写）。不伪造。 |
| **`child_process`、`cluster` 等** | 高 | 移动端无等价进程模型。 | 报告标注“不支持”，建议用原生能力（下载、后台任务、网络请求）替代。 |
| **动态 require 不可解析** | 中 | 表达式动态加载路径。 | 全量列入清单，提示用户手动映射或重构为静态引入。 |
| **`fs` 沙盒限制** | 中 | 读写受 Documents/Caches 限制，外部存储需权限。 | 在文档中说明路径映射、Scoped Storage、权限配置。必要时引导使用文档选择器。 |
| **后台保活** | 中-高（iOS 尤其） | App 进入后台后 JS 线程可能被系统挂起。长连接、定时任务需注意。 | 生成迁移指南提示：避免假定主进程“常驻不死”，改用前台服务、BackgroundTask、心跳重连等移动端思路。 |
| **`sendSync` 语义差异** | 中 | 即使同上下文也建议转异步，避免开发者继续依赖“同步阻塞”思路。 | AST 强制转换为 `async-promise`（默认）并全量暴露调用点。 |
| **第三方包强依赖 Electron** | 中 | 检测 `process.versions.electron`、直接 `require('electron')`。 | 已有占位替换 + 模块映射覆盖。检测到相关包时在报告中提示验证。 |

---

## 13. 快速开始（规划）

```bash
# 1. 全局安装（预发布）
npm i -g @e2rn/cli

# 2. 进入 Electron 项目
cd my-electron-app

# 3. 初始化配置
e2rn init

# 4. 可行性检测（强烈推荐）
e2rn check

# 5. 执行转换
e2rn convert

# 6. 运行生成的 RN 项目
cd rn-app
npm install
npx react-native run-android  # 或 run-ios
```

---

## 14. 设计总结

E2RN 的本质是：**用 React Native 内置 JS 引擎“直接承载”Electron 主进程，而不是“再造一个 Node 进程”。**

- **轻量**：省去 nodejs-mobile 带来的二进制体积和跨进程开销。
- **快**：同一 JS 上下文，IPC 几乎零延迟，业务逻辑执行更贴近原 Electron 体验。
- **务实**：放弃“全量兼容原生 Addon”和“伪造进程能力”，转而“检测→暴露→引导”。这比盲目尝试最终跑不起来要清晰得多。
- **可扩展**：插件化的 API 补全路径，让社区能逐步把常用 Electron API 映射到 RN。

正是吸取了 e2c 因 nodejs-mobile 导致“测试特别卡”这一教训，E2RN 彻底转向 **In-Process 运行时**，这也是最符合“让 Electron 用户用最小成本跑到移动端”这一初衷的路线。