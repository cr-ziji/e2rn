# E2RN

> Electron → React Native。把 Electron 的主进程**原样**放进 React Native 的 JS 引擎里跑，用 WebView 承载原有的界面。

E2RN 是一个 CLI 工具与运行时套件：读取一个 Electron 工程（**不做任何磁盘改写**），生成一个可构建、可运行的 React Native 工程，并输出一份能直接照着改的兼容性报告。

```bash
e2rn check      # 先告诉你哪些能过、哪些过不去、为什么
e2rn convert    # 生成 RN 工程（含报告与迁移清单）
cd rn-app && npm start
```

---

## 1. 它做什么

| 能力 | 说明 |
|---|---|
| 主进程同引擎运行 | 用户 `main` 及其依赖被打进 RN bundle，在 Hermes/JSC 中执行；不起独立 Node 进程（受能力矩阵约束） |
| 界面容器复用 | 每个 `BrowserWindow` 映射为一个 `react-native-webview` 容器，由 `WindowManager` 管理 |
| Electron API 替身 | `@e2rn/electron` 提供 `app` / `BrowserWindow` / `ipcMain` / `ipcRenderer` / `dialog` / `shell` / `Menu` 等实现 |
| Node 内置模块 | 按扫描结果注入 Polyfill；原生加速实现（如 crypto）由配置可选，默认纯 JS；同步 API、TCP 服务等无法实现的能力**显式报错**，不伪造 |
| 构建期解析映射 | 用 Metro/Babel preset 把 `electron`、`fs`、`node:*` 重定向到替身，源码保持原样 |
| 兼容性报告 | 每条风险带稳定规则 ID、代码位置、进程角色、修复建议 |
| 插件 | 用统一的贡献点补充 API、Polyfill、窗口 UI、原生依赖与分析规则 |

## 2. 它不做什么

先把边界说清楚，比事后解释便宜。

- **不移植 Chromium**。渲染层仍然是系统 WebView，不是桌面 Chrome。
- **不自动移植 C++ 插件**（`.node` / `node-gyp`）。这类依赖需要为 Android/iOS 重新编译，工具只负责发现并列出。
- **不伪造进程能力**。`child_process.spawn`、`cluster`、`vm`、`globalShortcut`、系统托盘、桌面采集、自动更新这些在移动端没有等价物，调用即抛错。（`fork` 是例外：Android 上映射为真实子进程，iOS 不支持，见 [docs/01-architecture.md](docs/01-architecture.md) §4.3。）
- **不保证一次转换就能上线**。它保证的是：**问题在动手前就暴露**，且每条都有位置、有原因、有替代方案。
- **不替你把 DOM 界面重写成 RN 组件**。那是产品重做，不是转换。

## 3. 运行模型

```text
构建期（Node 侧）                          运行期（设备侧）

Electron 源码（只读）                      域 A · RN Host（单 JS 上下文）
  scan → plan → emit  ─── 生成 RN 工程 ──►   用户主进程代码
  report / todos                             @e2rn/electron + polyfills
                                             EventBus · WindowStore · Bridge
                                                   │ postMessage / injectJavaScript
                                                   ▼
                                            域 B · WebView（独立 JS 引擎）
                                             原 index.html / 渲染脚本
                                             + 注入的 preload bundle
```

三条硬规则，后面所有设计都由此展开：

1. **主进程与 RN UI 在同一个 JS 上下文**，函数调用没有序列化开销。
2. **渲染层在 WebView 自己的引擎里**，与主进程之间只有异步消息通道——所以 `sendSync` 不可能真正同步。
3. **能力缺失必须显式**。宁可让调用点抛一条带链接的错误，也不要静默返回 `undefined`。

## 4. 能力分级

`e2rn check` 会给每个工程一个等级，等级决定"能不能直接转"：

| 等级 | 含义 | 典型特征 | 结论 |
|---|---|---|---|
| **T1** | 直接可转 | 单窗口、`ipcMain/ipcRenderer`、纯 JS 依赖、异步 fs | 生成即可跑，改动集中在入口与路径 |
| **T2** | 需替换实现 | 文件读写、对话框、通知、剪贴板、加密 | 用 RN 原生库替换，插件可覆盖大部分 |
| **T3** | 需重构 | 同步 `fs`、应用内 HTTP 服务、多进程、渲染层依赖 Node | 逐项改造，报告给出替代路径 |
| **T4** | 不建议迁移 | 依赖 `spawn` 外部二进制、桌面采集、全局快捷键为核心卖点 | 换方案或只做 UI 层重写 |

分级不是营销话术，它由规则命中结果直接算出（见 [docs/03-compatibility.md](docs/03-compatibility.md)）。

## 5. 快速开始

```bash
# 1. 安装
npm i -g @e2rn/cli

# 2. 在 Electron 工程根目录初始化
cd my-electron-app
e2rn init                 # 生成 e2rn.config.ts

# 3. 先体检（强烈建议）
e2rn check                # 终端摘要 + e2rn-report.md / .json

# 4. 转换（先看计划，不写文件）
e2rn convert --dry-run
e2rn convert

# 5. 跑起来
cd rn-app
npm install
npm start                 # 终端 A：Metro
npm run android           # 终端 B：构建并安装（或 npm run ios）
```

> 仓库正在按这套文档重建：命令、包名与行为以文档为目标契约；尚未发布的包不会出现在 npm 上。
> 源码改动由 Metro 的 `watchFolders` 直接监听；配置、插件或入口变更后重跑 `e2rn convert`（幂等，只写差异）。

常用命令：

| 命令 | 用途 |
|---|---|
| `e2rn init` | 生成 `e2rn.config.ts` |
| `e2rn check [--json] [--strict]` | 只体检，输出报告与 Tier |
| `e2rn convert [--dry-run] [--force] [--verify none\|resolve\|bundle]` | 生成 RN 工程；`--dry-run` 只打印计划 |
| `e2rn plugin add\|remove\|list\|info\|create\|verify` | 插件管理（不提供在线搜索） |
| `e2rn doctor` | 检查 Node / SDK / 设备工具链 |
| `e2rn config get\|set\|list` | 读写配置 |
| `e2rn restore` | 回滚上一次 emit 覆盖的生成物 |

两个默认关闭的选项（在 `e2rn.config.ts` 里显式开启）：

```ts
export default {
  // 原生加速：默认纯 JS；只为需要的模块开原生实现
  native: {
    strategy: 'js',
    modules: { crypto: 'native' }        // 例如改用 react-native-quick-crypto
  },
  // 源码复制：默认不复制；仅在需要交付独立工程时开启
  vendor: {
    enabled: false
  }
};
```

生成物结构：

```text
rn-app/
├── index.js                    # RN 入口：装运行时 → 加载主进程 → 注册 UI
├── e2rn.config.json            # 转换配置快照
├── metro.config.js             # 引用 @e2rn/metro-preset + 生成的映射表
├── babel.config.js             # 语法降级（import.meta / using / 装饰器等）
├── .e2rn/
│   ├── plan.json               # 转换计划（可审阅、可 diff）
│   ├── resolve-map.json        # 模块 → 实现 的最终映射表
│   ├── report.md / report.json # 兼容性报告
│   └── verify.json             # 验证结果
├── src/                        # 仅放胶水层
│   ├── App.tsx
│   └── runtime/
│       ├── boot.ts             # 启动序列
│       ├── loadMain.ts         # 动态加载用户主进程
│       └── feature-registry.ts # 生成的特性注册表（插件装配处）
├── android/  ios/              # RN 原生宿主工程（模板生成）
├── MIGRATION_GUIDE.md          # 映射规则 + 需要人工处理的地方
└── E2RN_TODOS.md               # 带复选框的待办清单
```

> `.e2rn/plan.json` 是转换的"施工图"。任何插件的贡献都会先落进 plan，再写文件——这让转换结果可审计，而不是黑箱。

## 6. 文档地图

| 文档 | 读它来解决什么 |
|---|---|
| [DESIGN.md](DESIGN.md) | 为什么这样设计；被否决的方案与代价 |
| [docs/01-architecture.md](docs/01-architecture.md) | 运行时由哪些域组成，IPC 怎么走，启动顺序为什么不能乱 |
| [docs/02-pipeline.md](docs/02-pipeline.md) | 转换流水线：scan / plan / emit / verify 的输入输出契约 |
| [docs/03-compatibility.md](docs/03-compatibility.md) | 判定模型、Electron/Node 支持矩阵、环境指纹、规则 ID |
| [docs/04-plugins.md](docs/04-plugins.md) | **插件架构规范**：贡献点、钩子、能力声明、冲突与版本 |
| [docs/05-plugin-guide.md](docs/05-plugin-guide.md) | **插件开发指南**：从脚手架到发布，7 个场景的完整代码 |
| [docs/06-runtime-api.md](docs/06-runtime-api.md) | 每个 Electron API 的语义契约与差异 |
| [docs/07-renderer.md](docs/07-renderer.md) | 窗口模型、preload 注入、wire 协议、资源服务、WebView 坑 |
| [docs/08-limitations.md](docs/08-limitations.md) | 明确不可移植清单与替代方案 |
| [docs/09-repository.md](docs/09-repository.md) | 仓库结构、包边界、测试与发布 |
| [docs/10-vscode-case.md](docs/10-vscode-case.md) | VS Code 1.141 转换复盘：阻断项、18 个坑、被推翻的判断 |

## 7. 设计原则

1. **不落盘改写用户源码。** 映射发生在解析层，源码是唯一事实源。
2. **能力分级，不做二元承诺。** "能不能转"要能量化成等级和清单。
3. **显式优于隐式。** 不支持的调用必须抛错；降级必须写进报告。
4. **运行时是包，不是生成物。** 生成项目只放胶水；运行时代码可升级、可测试、可被插件替换。
5. **先验证，再宣称。** 没有 fixture 或真机证据的兼容性声明，不进入"已解决"。

## 8. 许可证

MIT
