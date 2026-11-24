# E2RN 设计决策记录

> 本文件只回答一个问题：**为什么是这个方案，而不是别的。**
> 具体接口与流程规范在 `docs/` 下，本文件不重复。

每条决策包含：背景 → 决策 → 理由 → 代价 → 被否决的方案。

---

## D1 主进程跑在 RN 的 JS 引擎里（In-Process）

**背景**：Electron 主进程是 Node 代码。移动端要让这段代码跑起来，直觉方案是内嵌一个 Node 运行时（`nodejs-mobile`）。

**决策**：不引入独立 Node 进程。把主进程连同依赖打进 RN bundle，在 Hermes/JSC 中直接执行。

**理由**

- 绝大多数主进程逻辑是纯 JS：业务编排、状态、协议、规则、数据转换。它们不需要"进程"，只需要"引擎"。
- `nodejs-mobile` 需要额外内嵌 Node 二进制，包体多出 20–40MB；跨线程通信要序列化，实测交互明显卡顿。
- 原生插件（`.node`）在 `nodejs-mobile` 下并不会"自动可用"——仍须分别为 Android/iOS 编译。也就是说，付出了体积与性能代价，却没换来最关键的能力。
- 同一上下文里，`ipcMain` 与主进程内部调用都是普通函数调用，调试也在一个栈里。

**代价**

- 没有 Node 的线程/进程模型，`child_process`、`worker_threads`、`cluster` 不能按 Node 语义实现。
- 没有真正的同步 IO。`fs.readFileSync` 这类 API 无法保真（详见 D8）。
- 主进程与 RN UI 争抢同一个 JS 线程，长任务会卡界面。需要在报告里提示拆分。

**被否决**：`nodejs-mobile` 方案（包体、性能、集成复杂度三项全输，且未解决原生插件问题）。

---

## D2 渲染层用 WebView，不重写 UI

**背景**：Electron 的界面是 DOM。React Native 的界面是原生组件。两者没有自动映射关系。

**决策**：每个窗口 = 一个 `react-native-webview`。原 `index.html`、渲染脚本、样式原样加载；需要真实 origin 时由本地资源服务提供。

**理由**

- 把 DOM 树翻译成 RN 组件树，等价于重写产品。任何"自动转换 UI"的承诺都会在真实工程上崩掉。
- WebView 保留了浏览器的布局、字体、Canvas、SVG、动画能力，绝大多数 Electron 界面可以直接跑。
- 窗口管理（尺寸、层级、焦点）可以在 RN 侧做，WebView 只负责内容。

**代价**

- 移动端 WebView 不是桌面 Chrome：`<webview>` 标签、`getDisplayMedia`、自定义协议、`nodeIntegration` 都没有。
- `file://` 页面的 origin 是 opaque，模块脚本、Worker、CORS 请求会失败——必须提供 loopback 资源服务（见 [docs/07-renderer.md](docs/07-renderer.md)）。
- 多 WebView 内存开销大，窗口数量要克制。

**被否决**：DOM → RN 组件自动翻译；只支持用 RN 重写的"新 UI"（等于要求用户重做产品）。

---

## D3 非侵入 = 构建期映射，不是改写源码

**背景**：早期设计把用户 `main` 相关文件**复制**到生成工程的 `src/main/`，再对副本做 AST 改写（`require('electron')` → shim、路径替换等）。

**决策**：源码一个字节都不动。生成工程通过 Metro `watchFolders` 指向原工程，入口文件 `require` 原始 `main`；所有模块重定向在解析层完成。仅在**语法层**（Babel）做必要降级，且发生在内存中。

**理由**

- 复制会破坏相对路径、动态 `require`、`__dirname`、资源引用、monorepo 别名——真实工程几乎必然踩中。
- 复制产生两份事实源：用户改了源码，生成物不会自动跟随，只能重跑 `e2rn convert` 重新生成。
- AST 改写用户代码风险极高：改错一处，报错位置还指向生成物，排查成本翻倍。
- 解析层映射是打包器的原生能力：`extraNodeModules` + `resolveRequest` 就能覆盖 `electron`、`fs`、`node:*`、子路径、第三方包别名，且不改变代码语义。

**代价**

- 生成工程必须与源工程共存（不能单独打包成 zip 发走）。这对"交付一个独立 RN 工程"的诉求是妥协，但换来可持续迭代。
- 解析规则必须精确：`fs/promises`、`original-fs`、`node:fs`、`@scope/pkg/sub` 都要显式覆盖（见 [docs/02-pipeline.md](docs/02-pipeline.md) §6）。
- `require.resolve`、动态拼接的模块名无法在解析层处理，只能报告。

**被否决**：复制 + AST 改写；"转换一次后与原工程脱钩"的快照模式（可通过 `vendor.enabled` 显式开启，默认关闭）。

---

## D4 运行期是包，不是按项目生成的代码

**背景**：旧设计有一个 `generate-shim` 阶段：扫描到哪些 API，就生成对应 shim 代码。

**决策**：`@e2rn/electron`、`@e2rn/runtime`、`@e2rn/polyfills` 都是**版本化的 npm 包**。转换只生成装配代码（`feature-registry.ts`、`index.js`、配置文件）。

**理由**

- 生成的 shim 无法测试、无法复用、无法修 bug：每个项目一份拷贝，修一个缺陷要重转所有工程。
- "按需生成"听起来轻量，实际收益接近零：shim 是几十 KB 的 JS，按需裁剪省不下包体，却让行为随项目漂移。
- 运行时代码必须能被插件替换/增强。包 + 注册表是唯一能做到"稳定基座 + 可扩展"的形态。
- 真实工程的兼容问题来自**语义细节**（事件时序、错误码、返回值），这些只能靠集中维护和回归测试积累。

**代价**

- 需要维护一套跨平台运行时包，发布节奏与 CLI 解耦。
- 用户不能手改 shim（这是好事，但需要文档说明"要改就写插件"）。

**被否决**：按 API 清单生成 shim；把 shim 内联进用户工程。

---

## D5 环境指纹是一等公民

**背景**：真实转换里最先崩的往往不是 API，而是环境探测：

```js
if (process.versions.electron) { /* 桌面分支 */ }
const isNode = navigator.userAgent.startsWith('Node.js/');
const root = __dirname;
await import('./foo.js');   // 实际文件是 foo.ts
```

**决策**：把 `process` / `navigator` / `global` / `__dirname` / `import.meta` / `require.resolve` 当作一层显式的运行时能力，由 `@e2rn/polyfills` 统一安装、由报告单独列出使用点。

**理由**

- 这类探测决定了应用走哪条分支。指纹不对，后面所有 API 都"看起来能用但行为错"。
- Hermes 没有 `eval`、没有 `import.meta`、`TextDecoder` 可能缺失、`navigator` 只有 `product` 字段——这些都是真实崩溃源。
- 集中安装才能保证顺序：先 polyfill 全局，再装桥，再跑用户代码。

**代价**

- 需要伪造一部分环境（例如 `process.platform = 'linux'`），本质是"选择最接近的分支"。必须在文档中写明，不能假装等价。
- 某些库会检查更多字段（`process.arch`、`os.cpus()`、`process.resourcePath`），需要逐个补。

---

## D6 IPC 保真，但 `sendSync` 有硬边界

**背景**：旧文档认为"主进程与 IPC 在同一 JS 上下文，所以 `sendSync` 可以同步"。

**决策**：这个判断是错的，必须纠正。主进程在 RN 引擎里，**渲染层在 WebView 自己的引擎里**，两者之间只有异步消息通道。因此：

- `ipcRenderer.invoke` / `send` / `on`：完全可用，语义与 Electron 一致。
- `ipcRenderer.sendSync`：**不存在同步通道**。运行时提供三种策略：
  - `warn`（默认）：打印一次告警并返回 `undefined`，同时报告列出全部调用点；
  - `throw`：直接抛错，适合要求"零语义妥协"的工程；
  - `snapshot`：窗口加载前由主进程推送一份"同步通道快照"，`sendSync` 返回快照值（仅适用于启动时已知的小数据，如配置、版本）。
- 需要真正同步取值的场景（例如初始化时读配置），必须改成 `invoke` + 启动期串行初始化，或由 preload 注入。

**理由**

- 伪同步（忙等、递归泵事件）会死锁：WebView 的 JS 线程与 RN 的 JS 线程互等。
- 与其给一个"有时能返回"的假象，不如把边界写死，让改造点可枚举。
- `snapshot` 覆盖了真实工程里最常见的一类用法（启动期读常量配置），成本极低。

**代价**：`sendSync` 密集的工程需要改造；`snapshot` 需要用户声明哪些通道可快照。

---

## D7 子进程：Android 做真实进程，iOS 不做

**背景**：大型桌面 IDE 这类应用的主进程本质是"进程编排器"：扩展宿主、PTY 宿主、共享进程、文件监听全部 `fork`。这不是"某个 API 没实现"，而是架构前提。

**决策**：提供**可选的子运行时（Child Runtime）**：

- Android：`fork()` 映射为一个真实的 OS 进程（独立 Hermes VM + 独立 bundle），通过 LocalSocket 通信。主进程崩溃隔离、多核并行都能保住。
- iOS：不提供。App Store 沙盒不允许 `fork/exec`。
- `spawn` / `exec` / `execFile` 一律不支持——沙盒内无法执行外部二进制。

**理由**

- 在 Android 上，"多一个进程"是系统能力，能实现就该实现，否则 T3 工程一律无解。
- 每个子进程只加载自己的入口 bundle（`children/ptyHost` 等），避免"每个子进程都下载并解析整个主进程图"。
- iOS 上没有等价能力，如实标注比"给个假 fork"更有价值。

**代价**

- 需要原生模块与工程改造（多入口 bundle、进程管理器、socket 传输），属于高级能力，默认关闭。
- 子进程与主进程之间不能共享对象，消息必须可序列化（含二进制分块）。
- 调试复杂度上升：日志要带进程标签。

**被否决**：把 `child_process` 一律映射为 `unsupported`（对 T1/T2 工程够用，但让所有多进程应用直接判死刑）；用 `worker_threads` 模拟（RN 没有线程）。

---

## D8 Node 内置模块分级，不做"全量 Polyfill"

**决策**：按可实现程度分四档，写进矩阵，而不笼统说"支持 Node"。

| 档位 | 模块 | 处理 |
|---|---|---|
| 等价 | `path` `events` `buffer` `stream` `util` `assert` `url` `querystring` `string_decoder` `punycode` `zlib` | 成熟 browserify 实现，直接映射 |
| 近似 | `os` `crypto` `perf_hooks` `module` `async_hooks` `diagnostics_channel` | 自研 shim，补齐常用字段，差异写进报告 |
| 受限 | `fs` `http` `https` `net` `child_process` | 仅部分语义：异步 fs、客户端 HTTP、进程内 net、Android fork |
| 不支持 | `vm` `cluster` `worker_threads` `dgram` `tls` `dns` `tty` `repl` `inspector` `v8` | 调用即抛错，附替代方案 |

关键取舍：

- **`fs` 只做异步**。RN 的文件 API 是异步的，同步 API 无法在不阻塞 UI 线程的前提下实现。`readFileSync` 等直接抛错并指向 `fs.promises`。若确需同步，只能写原生模块（插件示例见 05）。
- **`http.createServer` 不支持**。移动端无法监听端口。应用内 HTTP 服务需改为 IPC，或用原生 HTTP 服务插件（Android/iOS 均可实现，但要处理前台服务与生命周期）。
- **`net` 是"进程内传输"，不是 TCP**。它能满足单实例锁、内部 socket 风格 API 的**启动流程**，但不能当真网络用。
- **`crypto` 不假设 `crypto.subtle` 存在**。Hermes 不提供 WebCrypto；默认用纯 JS 实现，需要性能时按 D13 开启原生变体。

**代价**：模块行为与 Node 有可感知差异，必须靠报告和文档让用户知情；`fs` 同步 API 的缺失会挡住一部分工程。

---

## D9 插件：贡献点 + 钩子 + 能力声明

**背景**：旧插件设计用 `type` 做互斥分类（`electron-api` / `builtin-polyfill` / `module-mapper` / `content-transform` / `template` / `window-ui` / `post-process`），每种类型一套接口，钩子分散在不同接口里。

问题：一个真实插件往往同时需要"实现一个 API + 补一条分析规则 + 声明原生依赖 + 提供一个 UI 组件"。按 `type` 分类会强迫作者把一件事拆成四个插件，或者塞进一个类型然后绕过类型约束。

**决策**：取消 `type`。插件由三部分组成：

1. **贡献点（contributes）**：向固定插槽投递实现（模块映射、Electron 特性、Node polyfill、环境补丁、UI、渲染注入、原生依赖、子进程入口、分析规则、报告片段）。
2. **钩子（hooks）**：在流水线的 6 个节点上做增量修改（`setup` / `onScan` / `onPlan` / `onEmit` / `onReport` / `onVerify`）。
3. **能力声明（resolves）**：声明"我解决了哪些内置规则"，并附证据。没有证据的声明会被降级，不允许靠一句 `solved: true` 把风险抹掉。

**理由**

- 插件作者只需要回答两个问题："我要加什么？"（贡献点）"我要在哪一步介入？"（钩子）。不需要先给自己归类。
- 声明式优先：80% 的插件只写 JSON 级配置，不写代码。
- 能力声明与报告打通，插件的价值可量化，也不能用来掩盖问题。
- 统一的贡献点让冲突可检测（同一模块被映射两次、同一 API 被实现两次），而不是靠加载顺序碰运气。

**代价**：需要维护贡献点 schema 与 `apiVersion`；旧插件需要迁移（映射表见 [docs/04-plugins.md](docs/04-plugins.md) §13）。

**被否决**：按 `type` 分支的插件；允许插件整包替换模板（升级即碎）；插件市场/在线安装（在没有生态前是负债）。

---

## D10 报告是一等产物

**决策**：`check` 与 `convert` 共用同一套规则引擎，产出 `report.md` / `report.json`；每条 finding 带稳定规则 ID、进程角色、位置、建议；`convert` 额外产出 `plan.json`、`MIGRATION_GUIDE.md`、`E2RN_TODOS.md`。

**理由**

- 转换工具的信任来自"它说清楚了哪里不行"。说不清楚的工具，用户只能靠试错。
- 稳定规则 ID 让报告可被 CI 断言、可被插件覆盖、可跨版本对比。
- `plan.json` 让转换可审计：为什么这个模块被映射到那个实现，一目了然。

**代价**：规则维护成本高；规则 ID 一旦发布不能随意改名，需要弃用流程。

---

## D11 构建集成交给 Metro/Babel，不自研打包器

**决策**：转换产物使用标准 RN 工程；映射通过 `@e2rn/metro-preset` + 生成的 `resolve-map.json`；语法降级通过 Babel 插件（`import.meta`、动态 `import()`、装饰器、`using`、class static block）。

**理由**

- 打包器的解析、缓存、HMR、source map 都是硬工程。自研等于重做一遍，并且永远追不上 RN 版本。
- 解析层是唯一能同时满足"非侵入"和"正确 source map"的位置。
- Babel 插件只处理语法，不改变模块语义，风险可控。

**代价**：生成工程与 RN 版本绑定，需要维护 preset 的兼容矩阵；Metro 的坑（`inlineRequires`、`browser` 字段、`sourceExts`）必须写进文档。

---

## D12 验证先于承诺

**决策**：`convert` 结束前执行三级验证，结果写入 `.e2rn/verify.json`：

1. **resolve-check**（默认）：模块图里每个说明符都能按映射表解析；
2. **bundle-check**（`--verify bundle`）：真正跑一次 `react-native bundle`；
3. **smoke**（设备上手跑）：`npm start` + `npm run android`，确认"启动 → `app ready` → 首个窗口 → 一次 IPC 往返"。

**理由**

- "能跑"必须由机器证明。只做静态扫描就宣布成功，是把调试成本转嫁给用户。
- 三级验证对应三类失败：映射错、打包错、运行时错。分开定位，修复成本最低。

**代价**：`bundle` 与 `smoke` 需要环境（Android SDK / 设备），不能在所有 CI 上跑；默认只跑第一级。

---

## D13 原生加速是可选变体，默认纯 JS

**背景**：`crypto`、`zlib` 这类模块同时存在纯 JS polyfill 与原生实现。默认启用原生，生成工程会平白多出原生依赖与编译要求；完全不支持，性能敏感场景又无路可走。

**决策**：默认 `native.strategy = 'js'`。插件可以为一个模块声明 `native` 变体，用户在 `e2rn.config.ts` 里按模块开启：

```ts
native: {
  strategy: 'js',
  modules: { crypto: 'native' }
}
```

**理由**

- 默认路径必须"拉下来就能构建"。原生依赖会破坏这一点，尤其在 CI 与无 Android/iOS 工具链的环境。
- 性能是个案需求，应该显式选择，而不是让所有用户承担包体与编译代价。
- 选择结果写入 `plan.json` 与报告，避免"以为开了原生，实际跑的是 JS"。

**代价**：需要维护两套实现与两套测试；切换后包体、算法覆盖、两端差异都要重新验证。

**被否决**：默认启用原生；完全禁止原生实现。

---

## 附录 A：被删除的设计

| 旧设计 | 为什么删 |
|---|---|
| `generate-shim` 按 API 清单生成 shim 代码 | 每个工程一份拷贝，无法测试与修复；改为版本化运行时包（D4） |
| 复制主进程源码到 `src/main/` 再 AST 改写 | 破坏相对路径与动态引用，产生双事实源（D3） |
| `preload` "原样保留" | WebView 里没有 `require`，preload 必须打成 IIFE bundle 才能跑（[07](docs/07-renderer.md)） |
| `sendSync` 同上下文可同步 | 渲染层在独立引擎，跨 WebView 无同步通道（D6） |
| `crypto.subtle` 在 Hermes 可用 | 实测不成立，需显式 polyfill（D8） |
| `child_process` 一律不支持 | Android 可做真实子进程；一律禁止会让多进程应用无解（D7） |
| 插件按 `type` 互斥分类 | 真实插件是多能力的；改为贡献点 + 钩子（D9） |
| 插件整包替换 RN 模板 | 模板一改，所有插件失效；改为 `native` + `ui` 贡献点 |
| 桌面窗口模式默认开启拖拽/缩放 | 手机上体验差且与系统手势冲突；默认全屏，窗口化仅平板可选（[07](docs/07-renderer.md)） |
| `e2rn plugin search/install` 从 registry 搜索 | 没有生态时是空壳；只保留 add/remove/list/verify |
| Phase 0–11 实施计划表 | 状态表会过期；进度交给 issue/里程碑，文档只描述稳定契约 |

## 附录 B：仍然成立的原则（来自早期设计）

- 进程角色（`main` / `preload` / `renderer`）逐文件标注，风险规则按角色生效——这是控制误报的关键。
- HTML 内联脚本要参与扫描，并把位置映射回宿主 HTML 行列。
- 动态 `require` 只做最保守推断，绝不猜测性注入。
- 原生 Addon 检测到即报出，不尝试自动迁移。
- 桌面端专属依赖（`electron-store`、`electron-updater` 等）单独提示。
