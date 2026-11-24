# 03 · 兼容性判定

> 这一章定义"能用/不能用"的判定标准，以及支撑判定的证据等级。
> 目标不是给出乐观结论，而是让每个结论都能追溯到一条规则和一处代码。

## 1. 四级支持标签

| 标签 | 含义 | 对用户意味着 |
|---|---|---|
| **等价** | 语义与 Electron/Node 一致（允许实现不同） | 不用改代码 |
| **近似** | 主要行为一致，存在可预期差异 | 读差异说明，确认是否受影响 |
| **受限** | 仅部分成员或场景可用，其余明确报错 | 需要按成员表核对用法 |
| **不支持** | 不提供实现，调用即抛错 | 必须替换方案 |

另有两个只用于矩阵的标记：**需插件**（基础运行时不提供，插件可补）、**需原生**（必须引入原生模块，纯 JS 无法实现）。

## 2. 判定模型

```text
扫描事实 ──► 规则命中（Finding） ──► 插件 resolves 调整 ──► 聚合
                                                          ├─ Tier（T1–T4）
                                                          └─ Verdict（ready/risky/blocked）
```

### 2.1 证据等级

每条"已解决"的声明必须带证据，否则不予采信：

| 证据 | 含义 | 效果 |
|---|---|---|
| `measured` | fixture + `plugin verify` 通过 + 真机记录（设备/日志） | 降为 `info`，报告标注"已上机" |
| `modeled` | fixture + 自动验证通过，未上机 | 降为 `info`，报告标注"未上机" |
| `declared` | 仅有文字声明，无 fixture | 降级无效，附 `plugin.unverified-claim` |

这条规则是为了防止"插件说解决了，报告就变绿"——兼容性结论必须可复核。

### 2.2 Tier 判定

| Tier | 触发条件（任一） |
|---|---|
| T1 | 无 `warn` 以上 finding；仅用等价/近似 API；无原生依赖 |
| T2 | 命中"需插件/需原生"类（fs、dialog、notification、crypto 等），但无架构性阻断 |
| T3 | 命中同步 `fs`、应用内 HTTP 服务、渲染层 Node 依赖、非字面量动态 import、`vm` 等 |
| T4 | 核心链路依赖 `spawn/exec` 外部二进制、桌面采集、全局快捷键、原生 Addon，且无替代 |

`blocked` 只在存在未解决的 `error` 时成立。T3 通常 `risky`，T4 通常 `blocked`。

## 3. Electron API 矩阵

> "差异"一列写的是**会咬人的地方**，不是完整文档。成员级契约见 [06-runtime-api.md](06-runtime-api.md)。

### 3.1 核心

| API | 标签 | 实现方式 | 关键差异 |
|---|---|---|---|
| `app` | 近似 | `@e2rn/electron/app` + RN 生命周期 | `getPath()` 映射沙盒目录；`isPackaged` 按构建态；`requestSingleInstanceLock()` 恒 `true`，`second-instance` 不触发；`quit()` 在 iOS 上无法真正退出 |
| `BrowserWindow` | 近似 | WindowStore + WebView | 没有原生窗口：`frame`、`titleBarStyle`、`transparent` 等装饰属性多数被忽略；全屏模式下 `setBounds` 无效；`isFullScreen()` 恒 `true`（fullscreen 模式） |
| `webContents` | 受限 | WebContents 仿真对象 | `send` 在页面加载完成前需排队；`executeJavaScript` 在 Android 上拿不到返回值（`injectJavaScript` 不返回）；`openDevTools` 不支持；`postMessage`/MessagePort 不支持 |
| `ipcMain` | 等价 | 进程内 EventBus | 唯一注意点：`event.senderFrame.url` 为空（自定义 scheme 解析不可靠），依赖 origin 校验的逻辑会走"跳过校验"分支 |
| `ipcRenderer` | 等价 | 注入到 WebView 的 `__e2rnIpc` | `sendSync` 无同步通道（见 §3.5）；`postMessage` 不支持 |
| `contextBridge` | 近似 | 在 WebView 的 preload 里实现 | `exposeInMainWorld` 可用；`exposeInIsolatedWorld` 不支持——WebView 没有隔离世界，安全边界弱于 Electron |
| `nativeTheme` | 近似 | `Appearance` | `shouldUseDarkColors` 可读；`themeSource` 只影响应用内渲染，改不了系统主题 |

### 3.2 交互与系统

| API | 标签 | 实现方式 | 关键差异 |
|---|---|---|---|
| `dialog.showMessageBox` | 近似 | 自绘 Modal | 异步版本可用；**`showMessageBoxSync` 不支持**（无法阻塞 UI 线程） |
| `dialog.showOpenDialog` | 需原生 | 文档/图片选择器 | 异步；返回值是 URI，需要复制到沙盒后才能当路径用 |
| `dialog.showSaveDialog` | 受限 | 导出到沙盒 + 分享 | 移动端没有"另存为路径"概念；只能"生成文件 → 让用户分享/保存" |
| `shell.openExternal` | 近似 | `Linking.openURL` | `mailto:`/`tel:` 可用；未安装的 scheme 会 reject |
| `shell.openPath` | 受限 | 系统 Intent / QuickLook | 仅限沙盒内文件；外部路径无权限 |
| `shell.showItemInFolder` | 不支持 | — | 无"文件管理器定位"概念 |
| `shell.trashItem` | 受限 | 删除 API | 多数平台无回收站语义，等价于删除，需二次确认 |
| `Menu` / `MenuItem` | 需插件 | 数据模型可用，渲染交给 UI 插件 | 默认不渲染；`setApplicationMenu` 为空操作；`popup()` 需插件映射到 ActionSheet |
| `Tray` | 不支持 | — | iOS 无托盘；Android 可用常驻通知近似，但不是同一交互 |
| `Notification` | 需原生 | `@notifee/react-native` 等 | 需权限、通知渠道；点击回调要自己接 |
| `clipboard` | 受限 | `@react-native-clipboard/clipboard` | 纯文本为主；图片/HTML/自定义格式需原生模块 |
| `screen` | 近似 | `Dimensions` + 安全区 | 单屏；`getAllDisplays()` 只返回一个；`getCursorScreenPoint` 不支持 |
| `powerMonitor` | 受限 | `AppState` | 只有前台/后台；锁屏、休眠、热启动等事件不可靠 |
| `globalShortcut` | 不支持 | — | 移动端没有全局键盘捕获 |

### 3.3 网络、会话与进程

| API | 标签 | 说明 |
|---|---|---|
| `net` | 受限 | 基于 `fetch` 的客户端请求；不支持自定义 CA、代理发现、HTTP/2 会话复用 |
| `session` | 受限 | 无独立会话分区；Cookie 由 WebView 管理，主进程侧不可编程 |
| `protocol` | 受限 | 不能注册自定义 scheme 处理器；可用本地资源服务 + URL 改写近似（见 [07](07-renderer.md)） |
| `utilityProcess` | 需插件（Android） | 映射到子运行时；iOS 不支持 |
| `MessageChannelMain` / `MessagePortMain` | 不支持 | 跨进程消息端口无法在 WebView 边界复现 |
| `safeStorage` | 需原生 | Keychain / Keystore 插件；纯 JS 无安全存储 |
| `crashReporter` | 受限 | 依赖原生崩溃上报；JS 异常可自行上报 |
| `systemPreferences` | 受限 | 仅少量只读项 |
| `desktopCapturer` | 不支持 | 无桌面可采集 |
| `autoUpdater` | 不支持 | 改用 App Store / Play / EAS Update / CodePush |
| `BrowserView` / `WebContentsView` | 不支持 | 不支持在一个窗口内嵌第二个浏览器实例 |
| `contentTracing` | 不支持 | 无 Chromium tracing |

### 3.4 渲染层专属能力

这些只在 `renderer` 角色下成立，扫描时按角色过滤，避免主进程误报：

| 能力 | 标签 | 说明 |
|---|---|---|
| `<webview>` 标签 | 不支持 | WebView 内不能再嵌 `<webview>`；改用窗口容器或 iframe（受同源限制） |
| `navigator.mediaDevices.getDisplayMedia` | 不支持 | 无屏幕采集源 |
| `chromeMediaSource: 'desktop'` | 不支持 | 桌面采集约束不存在 |
| `require` / `process` in renderer | 不支持 | 渲染层没有 Node；必须经 preload 暴露 |
| `nodeIntegration: true` | 不生效 | 该选项被忽略；渲染层永远拿不到 Node |

### 3.5 `sendSync` 专项

| 场景 | 结果 |
|---|---|
| `ipcRenderer.sendSync(ch)` + 主进程 `ipcMain.on(ch, e => e.returnValue = v)` | **不可保真**。跨 WebView 无同步通道。`snapshot` 策略下返回窗口加载前的快照值 |
| `ipcRenderer.sendSync` + `ipcMain.handle` | 不可能同步；`warn` 返回 `undefined`，`throw` 直接报错 |
| 建议改法 | `const v = await ipcRenderer.invoke(ch)`；启动期常量改为 preload 注入 |

`e2rn check` 会列出**全部**调用点（文件、行、通道、所在函数、代码片段），并给出改法。

## 4. Node 内置模块矩阵

| 模块 | 标签 | 实现 | 必须知道的限制 |
|---|---|---|---|
| `path` `events` `buffer` `stream` `util` `assert` `url` `querystring` `string_decoder` `punycode` `zlib` | 等价 | browserify 系实现 | `stream` 的 `pipeline`/`finished` 建议用 `stream-browserify` + `events` 组合验证 |
| `fs` | 受限 | `react-native-fs` 异步封装 | **同步 API 全部抛错**；无 `createReadStream`/`watch`；fd 是内存表模拟；错误码需归一化（`ENOENT` 等） |
| `os` | 近似 | 自研 | `platform` 映射为 `linux`（Android）/`darwin`（iOS，可配）；`cpus()`/`networkInterfaces()` 只给最小集；`homedir()` 指向沙盒 |
| `crypto` | 近似 | 默认 `crypto-browserify`；可切 `react-native-quick-crypto` | 不假设 `crypto.subtle` 存在；`randomBytes` 需原生；原生实现由 `config.native` 选择 |
| `http` / `https` | 受限 | 基于 `fetch` 的客户端 | 无 `createServer`；无 Agent/连接池/TLS 选项；流式上传需自行分块 |
| `net` | 受限 | 进程内 `EventEmitter` 传输 | 只能满足"启动时建 server/socket"的代码路径；不能收发真实 TCP |
| `tls` `dns` `dgram` | 不支持 | — | 无裸 socket / DNS 解析 / UDP |
| `child_process` | 受限 | `fork` → 子运行时（Android） | `spawn`/`exec`/`execFile` 全部不支持；iOS 连 `fork` 也没有 |
| `worker_threads` | 不支持 | — | RN 无线程；如需隔离只能用子运行时（Android） |
| `cluster` | 不支持 | — | 无多进程主从模型 |
| `vm` | 不支持 | — | Hermes 不提供运行时求值/独立上下文 |
| `perf_hooks` | 近似 | `performance.now()` + 计时器 | `gc`/`PerformanceObserver` 多数不可用 |
| `async_hooks` | 受限 | 最小"当前上下文"桩 | 只够满足依赖它的库完成初始化，不能做真实追踪 |
| `module` | 受限 | `createRequire`/`builtinModules` 桩 | 不支持运行时加载任意路径 |
| `process` | 近似 | npm `process` + 指纹补丁 | 见 §5；`kill()` 只对子进程有效 |
| `timers` | 等价 | RN 定时器 | `setImmediate` 用 `setTimeout(0)` 模拟 |
| `readline` `tty` `repl` `inspector` `v8` | 不支持 | — | 无终端/调试协议/引擎内省 |
| `sqlite` | 需原生 | `op-sqlite` / `react-native-sqlite-storage` | 需插件声明依赖与迁移 |

### 4.1 原生加速变体

有些模块同时有"纯 JS"和"原生"两种实现。**默认只用纯 JS**，用户在 `e2rn.config.ts` 里按模块开启原生：

```ts
native: {
  strategy: 'js',
  modules: { crypto: 'native' },
  packages: { crypto: 'react-native-quick-crypto' }
}
```

| 模块 | 纯 JS（默认） | 原生加速 | 切换后注意 |
|---|---|---|---|
| `crypto` | `crypto-browserify` | `react-native-quick-crypto` | 包体增大；部分算法缺失；`randomBytes` 必须走原生 |
| `zlib` | `browserify-zlib` | 生态中的原生压缩库（由插件声明） | 大文件解压的内存与线程占用 |
| `fs` | — | `react-native-fs`（本身就是原生） | 不是可选变体，只有异步 API |

选择结果会写进报告与 `plan.json`（`polyfills[].variant`）。没有对应原生实现时不会静默回退，除非 `strategy: 'auto'`。

## 5. 环境指纹

这是转换成败的隐形基础。用户代码几乎一定会探测环境来决定分支。

### 5.1 需要安装的全局

| 全局 | 取值 | 说明 |
|---|---|---|
| `process` | npm `process` 单例 | 必须替换 RN 自带的极简 `process`，否则 `require('process')` 与全局不是同一对象 |
| `process.versions.node` | 声明的 Node 版本（如 `20.11.1`） | 只用于分支判断，不代表真实能力 |
| `process.versions.electron` | 从工程 `package.json` 探测的真实版本 | 不要硬编码；用户代码可能做版本比较 |
| `process.type` | `'browser'` | Electron 主进程即 browser 类型；设成 `renderer` 会让部分库走错分支 |
| `process.platform` | Android → `linux`；iOS → `darwin` | 可配置；影响路径拼接与平台分支 |
| `process.arch` | 来自原生模块（`arm64`/`x64`） | 影响二进制/性能分支 |
| `process.argv` | 配置 + 启动注入（如 `--folder-uri`） | 空数组会让参数解析把首个 flag 当 argv[0] 吃掉 |
| `process.cwd()` | 工作区根目录 | 影响相对路径解析 |
| `process.env` | 继承 RN 环境 + 注入项 | `NODE_ENV` 必须存在 |
| `navigator.userAgent` | `Node.js/<version>` | RN 的 `navigator` 只有 `product`，缺 `userAgent` 会让大量库在模块求值期抛错 |
| `Buffer` `global` `setImmediate` | 对应 polyfill | `global` 必须指向 `globalThis` |
| `TextEncoder` / `TextDecoder` | polyfill（缺失时） | Hermes 有 Encoder，不一定有 Decoder |
| `__dirname` / `__filename` | Babel 注入的虚拟路径 | 指向源工程中的逻辑位置，不是设备路径 |
| `import.meta.url` | 降级为全局字符串 | Hermes 不解析 `import.meta` |
| `require.resolve` | 有限实现 | 只解析已知映射，未知抛错 |

### 5.2 `process` 必须是 EventEmitter

npm 的 `process` 浏览器 shim 把 `on/once/emit` 实现为空操作。Electron 主进程大量依赖 `process.on('uncaughtException')`、`process.on('warning')`、`process.on('message')`。必须用真实 `EventEmitter` 重新绑定这些方法，否则错误处理链路静默失效。

### 5.3 `app.getPath()` 映射

| Electron | Android | iOS |
|---|---|---|
| `userData` | `files/userData` | `Library/Application Support` |
| `appData` | `files` | `Library/Application Support` |
| `temp` | `cache` | `tmp` |
| `home` | `files/home` | `Documents` |
| `logs` | `cache/logs` | `Library/Logs` |
| `downloads` | 外部存储 / 需权限 | 不可直接访问 |
| `documents` | `files/documents` | `Documents` |

统一规则：**先沙盒，后共享**。访问外部文件一律走系统选择器，拿到 URI 后复制进沙盒再处理。

## 6. 第三方桌面依赖

| 包 | 风险 | 处理 |
|---|---|---|
| `electron-store` | 依赖 `app.getPath` + 同步 fs | 换 RN 存储（AsyncStorage/MMKV），或改异步 |
| `electron-updater` | 桌面更新链路 | 换 OTA 方案，不映射 |
| `electron-log` | 依赖主进程文件写入 | 换 `@e2rn/polyfills/logger` 或 RN 日志库 |
| `electron-window-state` | 依赖窗口持久化 | 换自研存储（窗口状态在 WindowStore 里） |
| `@electron/remote` | 跨进程对象代理 | 不支持；改 contextBridge + IPC |
| `electron-context-menu` | 桌面右键菜单 | 用 UI 插件做长按菜单 |
| 终端/键位/数据库等原生包（`node-pty`、`native-keymap`、`sqlite3`） | 原生 Addon | 见 [08](08-limitations.md) |
| `bindings` / `node-gyp-build` / `node-pre-gyp` | 原生加载器 | 检测到即报；需重新为移动端编译 |

## 7. 规则 ID 规范

规则 ID 是报告的最小单元，一旦发布不得改名（只能弃用）。

| 前缀 | 归属 | 示例 |
|---|---|---|
| `project.*` | 工程结构 | `project.package-json`、`project.main-entry`、`project.parse-failures` |
| `electron-api.*` | Electron API | `electron-api.dialog.showSaveDialog`、`electron-api.globalShortcut` |
| `builtin.*` | Node 内置 | `builtin.fs.sync`、`builtin.net`、`builtin.child_process` |
| `env.*` | 环境指纹 | `env.process-versions-electron`、`env.import-meta`、`env.navigator-useragent` |
| `dynamic-require.*` | 动态引入 | `dynamic-require.resolved`、`dynamic-require.unresolved` |
| `native-module.*` | 原生模块 | `native-module.found`、`native-module.loader` |
| `send-sync.*` | sendSync | `send-sync.found` |
| `renderer.*` | 渲染层 | `renderer.webview-tag`、`renderer.get-display-media`、`renderer.node-integration` |
| `verify.*` | 验证 | `verify.unresolved-module`、`verify.bundle-failed` |
| `plugin.*` | 插件自身 | `plugin.load-error`、`plugin.rule-error`、`plugin.unverified-claim` |
| `<rulePrefix>.*` | 插件规则 | `acme.dialog.partial-save` |

约定：

- 内置 ID 集中在 `packages/core/src/compat/rule-ids.ts` 声明。
- 插件规则 ID 含点号视为完整 ID；不含点号自动补 `<rulePrefix>.` 前缀（推导规则见 [04](04-plugins.md) §5.9）。
- 同一 ID 的语义不得跨大版本改变；需要改变时新增 ID 并弃用旧的。

## 8. 报告结构

`report.md` 固定章节（顺序稳定，便于 diff）：

1. 结论（Tier + Verdict + 关键数字）
2. 项目概况（入口、依赖、Electron 版本）
3. 进程角色分布
4. HTML 脚本清单
5. Electron API 覆盖矩阵
6. Node 内置模块策略
7. 环境指纹使用点
8. 动态引入清单
9. 原生模块清单
10. `sendSync` 调用点
11. 风险与待办（按 severity 排序，每条带规则 ID + 位置 + 建议）
12. 扫描覆盖度说明（解析失败文件）

表格里的 API 兼容度同时给出 0–5 星（便于快速扫视）与文字标签（作为判定依据）。两者冲突时以标签为准。

`report.json` 与之一一对应，供 CI 断言：

```json
{
  "tier": "T3",
  "verdict": "risky",
  "summary": { "scannedFiles": 11801, "errors": 3, "warnings": 17 },
  "findings": [{ "id": "native-module.found", "severity": "error", "locations": [] }]
}
```

## 9. 误报控制

| 手段 | 作用 |
|---|---|
| 角色过滤 | `renderer.*` 规则只在 renderer 文件生效；`node-integration` 只在 `BrowserWindow` 构造点生效 |
| 入口链路 | 未纳入任何入口的文件不参与角色判定，不产生"看似相关"的风险 |
| 解析回退 | script → module 双解析，避免严格模式误判 CommonJS |
| 动态引入不做推断 | 只报告，不猜测性替换 |
| 证据等级 | 未验证的插件声明不改变结论 |
| 显式 `unknown` | 未收录的 API 标"未收录"，而不是"不支持" |

> 报告里出现一条误报，用户就会开始怀疑全部结论。宁可少报一条，也不要报错一条。

案例基线见 [10-vscode-case.md](10-vscode-case.md)。
