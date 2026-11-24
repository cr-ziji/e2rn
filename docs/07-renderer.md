# 07 · 窗口与渲染层

> 渲染层是转换后最容易"看起来正常、实际不可用"的部分。原因几乎都出在 **origin、注入时机、导航与焦点** 这四件事上。

## 1. 三种渲染策略

```text
原工程有 index.html / 前端构建产物？
├─ 是 → 页面是否依赖「真实 origin」？（ES Module、Worker、CORS、Service Worker、History 路由）
│        ├─ 否 → 策略 R1：WebView 直接加载本地文件
│        └─ 是 → 策略 R2：本地资源服务（http://127.0.0.1:<port>）
└─ 否 → 策略 R3：用 RN 重写界面（不属转换范畴，模板/插件可提供骨架）
```

| 策略 | 适用 | 代价 |
|---|---|---|
| **R1 本地文件** | 单页、脚本内联、无模块化、无跨域请求 | `file://` 的 origin 是 opaque：模块脚本、Worker、`fetch` 相对路径、部分存储 API 会失败 |
| **R2 资源服务** | 绝大多数真实工程 | 需要原生 HTTP 服务（约 200 行），启动/关闭要跟生命周期绑定 |
| **R3 RN 重写** | 界面简单、希望原生体验 | 等于重做 UI，转换工具只提供骨架 |

默认选择：**R2**。理由很实际——现代前端产物几乎都是 ES Module + Worker + 绝对路径资源，`file://` 跑不起来。资源服务同时解决了自定义 scheme（如 `app-file://`）无法被 WebView 加载的问题。

## 2. WindowManager

### 2.1 组成

```text
WindowManager（容器）
├── Window × N
│   ├── WindowTitleBar（可选，UI 槽）
│   └── WebView（内容）
└── Overlay 层（对话框、Toast、加载态）
```

- **一个窗口 = 一个 WebView 实例**。不要试图用 iframe 模拟多窗口：同源限制会让跨窗口通信变得比 IPC 更麻烦。
- **窗口状态在 store，不在组件**。主进程改窗口属性（`setTitle`、`setBounds`）直接改 store，React 响应式更新。
- **窗口关闭要级联**：子窗口随父窗口关闭；未完成的 invoke 要 reject，避免 Promise 永久挂起。

### 2.2 三种模式

| 模式 | 布局 | 适用 | 默认 |
|---|---|---|---|
| `fullscreen` | 单窗口铺满 + 安全区 | 手机；绝大多数应用 | 是 |
| `stack` | 卡片纵向堆叠，点击置顶 | 平板；需要保留多窗口语义 | 否 |
| `desktop` | 自由位置/尺寸，可拖拽缩放 | ≥ 10 吋平板 + 外接键鼠 | 否 |

为什么默认全屏：手机上没有"窗口"隐喻，拖拽/缩放会与系统手势冲突（边缘返回、底部上滑），且小屏上多窗口没有可用性。窗口化是"给平板留的口子"，不是默认体验。

配置：

```ts
electron: {
  browserWindowDefaults: {
    windowMode: 'fullscreen',
    showTitleBar: false,
    resizable: true,
    movable: true
  }
}
```

### 2.3 重挂载语义

```tsx
const key = `${win.url ?? win.file ?? 'default'}#${win.reloadNonce}`;
<WebView key={key} source={source} ... />
```

Electron 的 `loadURL` 即使 URL 不变也会重新导航。WebView 的 `source` 不变则不会重新加载，所以必须靠 `key` 变化强制重建。`reloadNonce` 由 Bridge 在每次 `loadURL` / `reload` 时自增。

代价：重建会丢页面状态（滚动位置、表单）。这与 Electron 行为一致，属于预期。

## 3. preload 注入管线

### 3.1 顺序（不可调换）

```text
1. window.__E2RN_ARGV__ = [...]        // additionalArguments
2. IPC bridge                          // window.__e2rnIpc（send/invoke/on）
3. 内置 sandbox 兼容层                  // process / window.host / 必要的 polyfill
4. 插件注入（contributes.renderer，按优先级）
5. 用户 preload（打成 IIFE 的 bundle）
```

顺序理由：

- `__E2RN_ARGV__` 必须最先，因为后面的脚本可能读命令行参数（窗口配置、调试开关）。
- IPC bridge 必须先于用户 preload，否则 `contextBridge` 无通道可用。
- 插件的兼容层要在用户代码前，用户 preload 可能依赖它。

### 3.2 用户 preload 必须打包

Electron 的 preload 运行在 Node 环境，可以 `require('fs')`。WebView 里**没有** `require`。所以：

- `preload.js` 不能直接作为字符串注入；
- 必须先用打包器把它及其相对依赖打成 IIFE，再注入；
- preload 里对 Node 内置模块的引用，会被映射到 polyfill 或直接报错（取决于角色策略）。

```ts
// 生成物示意
const preloadBundle = require('./.e2rn/preload/main.bundle.js');   // 字符串
injectedJavaScriptBeforeContentLoaded = buildInjection({
  argv,
  bridge: IPC_BRIDGE,
  sandbox: SANDBOX_COMPAT,
  plugins: [...],
  userPreload: preloadBundle
});
```

### 3.3 `contextBridge` 的近似

```js
// 用户 preload
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  load: () => ipcRenderer.invoke('data:load'),
  onChange: (cb) => ipcRenderer.on('data:changed', (_e, v) => cb(v))
});
```

在 WebView 中：

- `exposeInMainWorld` → 直接把对象挂到 `window`；
- 函数跨边界时包装成异步代理（参数/返回值走 wire 编码）；
- **没有隔离世界**，页面脚本可以改写 `window.api`。安全模型弱于 Electron，敏感能力必须在主进程侧校验，不能只靠"没暴露"。

### 3.4 注入脚本的幂等

页面可能因为 `loadURL`、崩溃恢复、HMR 被多次注入。所有注入脚本必须自带护栏：

```js
if (window.__e2rnInjected) return;
window.__e2rnInjected = true;
```

否则监听器会重复注册，表现为"一次点击触发两次"。

## 4. wire 协议（渲染侧）

```ts
// 渲染 → 宿主
{ __e2rn: true, type: 'ipc-send',   channel, args }
{ __e2rn: true, type: 'ipc-invoke', channel, args, requestId }

// 宿主 → 渲染
{ __e2rn: true, type: 'ipc-event', channel, args }
{ __e2rn: true, type: 'ipc-reply', requestId, result | error }
```

渲染侧要处理的三件事：

1. **二进制**：`ArrayBuffer` / TypedArray / `Buffer.toJSON()` 统一转 base64 信封（[01](01-architecture.md) §7）。
2. **监听器签名**：Electron 是 `(event, ...args)`，Web 侧习惯 `(payload)`。包装层要补 `event` 对象（至少含 `senderId`、`channel`、`reply`）。
3. **错误传递**：宿主侧异常序列化为 `{ error: string }`，渲染侧重新构造 `Error`，保留 message；堆栈默认不跨边界（可在开发态开启）。

## 5. 本地资源服务

### 5.1 为什么需要

| 问题 | `file://` | `http://127.0.0.1` |
|---|---|---|
| ES Module | 多数 WebView 拒绝（opaque origin） | 正常 |
| Web Worker | 拒绝 | 正常 |
| `fetch('./data.json')` | 部分失败 | 正常 |
| Service Worker | 不支持 | 支持（需 HTTPS 或 localhost） |
| History 路由 | `pushState` 受限 | 正常 |
| 自定义 scheme 资源 | 无法加载 | 由服务端重写路径 |

### 5.2 实现要求

- 只监听 `127.0.0.1`，**不要** `0.0.0.0`。
- 端口动态分配（`0` → 系统分配），把实际端口写入 `NativeModules.E2RNRuntime.assetServerPort`。
- 根目录 = 生成工程的 `assets/web/`（或用户指定的 `rendererRoot`）。
- 路径穿越防护：解析后必须仍在根目录内。
- MIME 表要覆盖 `js/mjs/css/json/wasm/woff2/svg/png`。
- 生命周期跟随 App：启动时起、退到后台可保留、退出时关。

### 5.3 资源根与逻辑路径

真实工程里常见"逻辑路径"与"设备路径"不一致：

```text
逻辑：/builtin/extensions/...       （代码里写死）
设备：/data/data/<pkg>/files/builtin/extensions/...
```

处理：`fs` polyfill 提供 `setAssetRoot()`，把某个前缀映射到真实目录（[03](03-compatibility.md) §4）。资源服务同理，把 URL 前缀映射到目录。两处映射必须使用同一个根，否则会出现"文件系统能读到、页面加载 404"。

## 6. 自定义 scheme 改写

Electron 应用常用 `app://`、`app-file://`、`res://` 加载资源。WebView 不认识这些 scheme，表现为白屏或字体/图标缺失。

处理方式（按优先级）：

1. **服务端映射**：资源服务把 `/app/*` 映射到构建产物目录，页面里的绝对 URL 改为 `http://127.0.0.1:<port>/app/*`。
2. **注入期改写**：在 `before-content` 注入脚本里拦截 `src`/`href` 与 CSSOM 中的 `url(...)`。
3. **协议注册**：Android 可用 `WebViewClient.shouldInterceptRequest` 拦截；iOS 用 `WKURLSchemeHandler`。属于原生能力，插件实现。

CSS 里的 URL 常被转义（`url('app-file\:\/\/...')`），字符串替换会漏。正确做法是遍历 `document.styleSheets` 的 `cssRules`，对 `style` 属性逐条改写，并用 `MutationObserver` 处理动态插入的 `<style>`。

## 7. WebView 坑清单

| 现象 | 原因 | 处理 |
|---|---|---|
| 菜单点不开 / 下拉被遮住 | 部分 Android WebView 的 `document.hasFocus()` 恒 `false`，页面进入"未聚焦"样式，`opacity < 1` 创建了新层叠上下文 | 注入脚本覆盖 `document.hasFocus = () => true` |
| 字体图标变方框 | `@font-face` 用了自定义 scheme | 按 §6 改写 CSSOM |
| 状态栏/手势条压住内容 | Android 15 强制 edge-to-edge | 窗口容器读安全区并加内边距 |
| 返回键直接退出应用 | 未拦截硬件返回 | `BackHandler`：先让 WebView `goBack()`，无历史再关窗口 |
| 键盘弹起遮住输入框 | WebView 未调整 resize 模式 | Android `windowSoftInputMode="adjustResize"` + 滚动容器 |
| `<input type="file">` 无反应 | WebView 未实现文件选择回调 | 原生 `onShowFileChooser`，或改用 `dialog.showOpenDialog` |
| 下载链接无反应 | WebView 默认不处理下载 | 拦截导航 → 原生下载器 / `react-native-blob-util` |
| 页面白屏但无报错 | `file://` + 模块脚本 / 资源 404 | 切 R2 资源服务；看 `onError` 与资源服务日志 |
| 外链把整个应用导航走 | 未限制 `originWhitelist` | 拦截非本地导航 → `shell.openExternal` |
| 第二次 `loadURL` 不生效 | WebView `source` 未变 | `reloadNonce` 作为 `key`（§2.3） |
| 注入脚本执行两次 | 页面重载后重复注入 | 幂等护栏（§3.4） |
| `executeJavaScript` 拿不到值 | Android `injectJavaScript` 不返回结果 | 关联 id + 页面回传（§4） |

## 8. 性能

| 关注点 | 建议 |
|---|---|
| 多窗口内存 | 每个 WebView 约 50–150MB；同时存活窗口建议 ≤ 3，其余冻结或销毁重建 |
| 首屏 | 先渲染窗口骨架（`window.background` 槽），再加载 WebView；避免白屏 |
| 大 bundle | 资源服务支持 gzip/br；页面侧按需拆包 |
| 频繁 IPC | 合并消息（批量事件），避免每帧一次 `postMessage` |
| 长任务 | 主进程与 UI 共用 JS 线程；重计算拆到子运行时（Android）或原生 |
| 动画 | 窗口过渡用 RN 动画；页面内动画交给 WebView，二者不要互相驱动 |

## 9. 安全

- 资源服务只绑定回环地址，且校验 `Host` 头，防止 DNS rebinding。
- 注入脚本视为可信代码；用户页面视为不可信：不要从页面接收"要执行的文件路径/命令"。
- `originWhitelist` 收紧到本地资源服务与必要的 `https` 域名。
- 外部导航一律走 `shell.openExternal`，不在应用内打开。
- 敏感数据（token、密钥）不要经 `exposeInMainWorld` 暴露给页面；放主进程，按需签发短期凭证。

## 10. 验收清单

- [ ] 冷启动到首屏 < 3s（中端机）
- [ ] 旋转屏幕后布局与安全区正确
- [ ] 返回键行为：页面内后退 → 关闭窗口 → 退到桌面
- [ ] 键盘弹起不遮挡输入框
- [ ] 外链走系统浏览器
- [ ] 页面重载 3 次后无重复监听、无内存增长
- [ ] 关闭窗口后 WebView 实例被销毁（内存回落）
- [ ] 弱网/断网时有可读的错误页，而不是白屏
