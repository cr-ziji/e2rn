# 02 · 转换流水线

> 转换不是"一把梭"，而是四个可独立运行的阶段：**scan → plan → emit → verify**。
> 每个阶段的输入输出都是可序列化的数据，因此可以 dry-run、可以 diff、可以被插件在中间插入。

```text
e2rn check   = scan + classify + report
e2rn convert = scan + classify + plan + emit + verify + report
开发         = cd rn-app && npm start（Metro 直接监听原工程）
```

## 1. 阶段总览

| 阶段 | 输入 | 输出 | 失败策略 |
|---|---|---|---|
| `preflight` | 配置、环境 | 校验结果 | 缺配置/缺工具链 → 中止 |
| `scan` | Electron 工程（只读） | `ScanResult` | 单文件解析失败 → 记录并继续 |
| `classify` | `ScanResult` + 插件规则 | `Finding[]` + `Tier` + `Verdict` | 阻断项 → 除非 `--force` 否则中止 |
| `plan` | 扫描结果 + 插件贡献 + 配置 | `ConversionPlan`（纯数据） | 冲突（同一模块两种映射）→ 报错 |
| `emit` | `ConversionPlan` | RN 工程文件 | 已存在且非生成物 → 默认不覆盖，`--force` 才覆盖 |
| `verify` | 生成工程 | `verify.json` | 失败 → 保留产物并给出定位信息 |
| `report` | 以上全部 | `report.md` / `report.json` / `MIGRATION_GUIDE.md` / `E2RN_TODOS.md` | 不影响主流程 |

设计意图：**plan 与 emit 分离**。所有"要不要做、怎么做"的决策都在 plan 阶段完成；emit 只是无脑执行。这样 `--dry-run` 打印的就是真实执行内容，而不是另写一套模拟逻辑。

每个阶段都对应一个插件钩子（`onScan` / `onPlan` / `onEmit` / `onReport` / `onVerify`），钩子只能返回增量 patch，不能替换阶段产物。钩子契约见 [04-plugins.md](04-plugins.md) §6。

## 2. scan：只读地理解工程

### 2.1 入口发现

| 来源 | 提取规则 | 角色 |
|---|---|---|
| `package.json#main` | 直接取值；支持 `.js/.ts/.mjs/.cjs` 与目录（读 `index.*`） | `main` |
| `new BrowserWindow({ webPreferences: { preload } })` | 仅接受**字面量字符串**或 `path.join(__dirname, '...')` 这类可静态求值的表达式 | `preload` |
| `win.loadFile('...')` / `win.loadURL('file://...')` | 字面量；`loadURL('http...')` 记为目标但不算本地入口 | `renderer` |
| HTML `<script src>` | 相对路径解析；`http(s)://` / `//` 记为"外部，不解析" | `renderer` |

多入口是常态：一个设置窗口、一个关于窗口、多个 preload（不同窗口不同权限）。扫描结果必须保留**全部**入口，不能只取第一个。

### 2.2 语法与语义扫描

| 关注点 | 方法 | 产物 |
|---|---|---|
| Electron API 调用 | 识别 import/require 绑定 → 追踪成员访问链 | `apiUsages`（含 module/member/kind/locations） |
| Node 内置模块 | 说明符归一化（`node:fs`、`fs/promises` → `fs`） | `builtinUsages` |
| 动态引入 | 参数是否字面量；常量拼接做最保守推断 | `dynamicRequires` |
| 原生模块 | `.node` 后缀、`bindings()`、`node-gyp-build`、`prebuild` 依赖 | `nativeModules` |
| `sendSync` | 识别调用点、通道名、所在函数、实参 | `sendSyncCalls` |
| 环境指纹 | `process.versions.electron`、`process.type`、`navigator.userAgent`、`import.meta`、`__dirname`、`require.resolve` | `envProbes` |
| 同步 fs | `fs.*Sync`、`fs.existsSync` | `syncFsCalls` |
| 渲染层危险能力 | `<webview>`、`getDisplayMedia`、`chromeMediaSource`、`nodeIntegration: true` | `riskyPatterns`（按角色） |

**解析宽容度**：JS/TS 先按 script（非严格）解析，失败再按 module 解析。Electron 主进程大量使用 CommonJS，严格模式会把合法写法判成语法错误，产生假阳性。

**HTML 内联脚本**：没有对应磁盘文件，用 `xxx.html#inline-2.js` 作为虚拟文件参与分析，再把位置映射回 HTML 行列（首行叠加列偏移，其余行只平移行号）。

### 2.3 必须识别的真实工程特征

这些是实际转换中反复导致失败的点，扫描阶段就要收集，而不是等打包报错：

| 特征 | 为什么重要 | 处理 |
|---|---|---|
| `tsconfig.json` 的 `paths` 别名 | Metro 不读 tsconfig，别名会解析失败 | 读入并转成 `moduleMap` 条目 |
| NodeNext 风格的 `./foo.js` 实际是 `foo.ts` | Metro 默认不回落 `.ts` | preset 的 `resolveRequest` 加后缀回落 |
| `"type": "module"` / `.mjs` 混用 | 影响 Babel 与解析行为 | 记录，emit 时配置 `sourceExts` 与 transform |
| 动态 `import(expr)`（非字面量） | Metro collector 直接抛错，打包中断 | 计划阶段标记为 **build-breaking**；提供 Babel 改写为 rejected promise 的选项 |
| `package.json#browser` 字段 | 会把 Node 入口改写成浏览器入口，导致 API 缺失 | 需要 `forceNodeEntry` 映射（见 §6.3） |
| monorepo / workspace 依赖 | 源码在 `node_modules` 之外 | `watchFolders` 纳入；映射表按真实路径解析 |
| 顶层 `await` / `using` / 装饰器 | Hermes/RN preset 不支持 | 列入 Babel 降级清单 |
| 资源路径（图标、模板、wasm） | 打包后路径变化 | 资源清单 + 资源根目录映射 |

### 2.4 ScanResult 契约

扫描结果是 classify / plan / report 的共同输入，字段必须可序列化（便于缓存与插件消费）。

```ts
interface ScanResult {
  root: string;
  entries: { main?: string; preloads: string[]; renderers: string[] };
  files: Array<{
    path: string;
    relativePath: string;
    roles: ProcessRole[];
    reason: FileRole['reason'];
    parseError?: string;
  }>;

  apiUsages: ElectronApiUsage[];        // 含 module/member/kind/locations
  builtinUsages: BuiltinUsage[];        // 归一化模块名 + 原始 specifier
  dynamicRequires: DynamicRequireInfo[];
  nativeModules: NativeModuleUsage[];
  sendSyncCalls: SendSyncCall[];

  envProbes: Array<{ kind: EnvProbeKind; location: SourceLocation }>;
  syncFsCalls: Array<{ member: string; location: SourceLocation }>;
  riskyPatterns: RiskyPattern[];        // 按 roles 过滤后使用
  htmlScripts: HtmlScriptRef[];

  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  unreachableFiles: string[];
  parseFailures: ParseFailure[];
}

type EnvProbeKind =
  | 'process.versions.electron' | 'process.type' | 'process.platform'
  | 'process.argv' | 'navigator.userAgent' | 'import.meta'
  | '__dirname' | '__filename' | 'require.resolve';
```

`envProbes` 与 `syncFsCalls` 是新增的独立事实，不再混在 `riskyPatterns` 里：它们需要按角色、按成员给出不同的替代建议（[03](03-compatibility.md) §5）。

### 2.5 动态引入的处理策略

静态分析无法穷尽动态加载，处理原则是"**识别、保守推断、显式暴露、不猜测替换**"：

1. **识别**：`require()` / `import()` / `require.resolve()` 的参数是否为字面量；非字面量一律进 `dynamicRequires`。
2. **保守推断**：只对"字符串常量 + 常量"这类最简单拼接做推断，其余标为不可解析。
3. **显式暴露**：报告列出文件、行列、表达式、可能涉及的模块（保守列举，不声称完整）。
4. **生成待办**：写入 `E2RN_TODOS.md`，提示人工确认影响范围；必要时由 `moduleMap` 插件显式映射。
5. **不强行替换**：不根据猜测注入 polyfill 或改写调用，避免"看起来能跑、运行时才炸"。

对 Metro 而言，**非字面量 `import()` 是构建阻断项**（collector 直接抛错），必须在 plan 阶段单独标记，并提供"改写为 rejected promise"的 Babel 选项（见 §6.2）。

## 3. classify：把扫描结果变成结论

规则引擎把 `ScanResult` 转成 `Finding[]`，再聚合出等级与结论。

```ts
type Tier = 'T1' | 'T2' | 'T3' | 'T4';
type Verdict = 'ready' | 'risky' | 'blocked';

interface Finding {
  id: string;                  // 稳定规则 ID，如 native-module.found
  category: 'project' | 'electron-api' | 'builtin' | 'dynamic-require'
          | 'native-module' | 'send-sync' | 'env' | 'renderer' | 'verify' | 'plugin';
  severity: 'error' | 'warn' | 'info';
  title: string;
  description: string;
  suggestion?: string;
  locations?: SourceLocation[];
  meta?: Record<string, unknown>;   // 计数、模块名、替代包等
}
```

聚合规则：

- 任一 `error` → `blocked`（`--force` 可继续，但报告标注"已强制"）。
- 存在 `warn` 或等级 ≤ T3 → `risky`。
- 全部 `info` 且等级 T1 → `ready`。
- 插件 `resolves` 可降级，但**只有带证据的声明**才降到 `info`；无证据的降一级并注明"未验证"（见 [04-plugins.md](04-plugins.md) §8）。

## 4. plan：施工图

`ConversionPlan` 是转换的单一事实源，写入 `.e2rn/plan.json`，可提交到仓库、可 code review。

```ts
interface ConversionPlan {
  version: 1;
  project: {
    name: string;
    electronRoot: string;       // 绝对路径（plan 里同时存相对路径用于 diff）
    outDir: string;
    electronVersion?: string;
    packageManager: 'npm' | 'pnpm' | 'yarn';
  };
  entries: {
    main: string;               // 用户主进程入口（相对 electronRoot）
    preloads: string[];
    renderers: string[];
    children?: Array<{ id: string; entry: string; bundle: string }>;
  };
  resolveMap: ResolveEntry[];   // 模块 → 实现
  features: FeatureBinding[];   // electron 子 API → 实现模块
  polyfills: PolyfillBinding[];
  boot: BootTask[];             // 有序启动任务
  ui: { slots: SlotBinding[]; windowMode: 'fullscreen' | 'stack' | 'desktop' };
  native: NativeRequirement[];
  files: PlannedFile[];         // 将要写出的文件（含来源：template / generated / plugin）
  patches: FilePatch[];         // 对生成文件的定点修改（如 app.json 字段）
  verify: { level: 'none' | 'resolve' | 'bundle' };
  warnings: string[];
}

interface ResolveEntry {
  from: string;                 // 'electron' | 'fs' | 'node:fs' | '@scope/pkg'
  to: string;                   // 'electron' | '@e2rn/polyfills/fs' | './runtime/x.ts'
  scope?: 'all' | 'main' | 'preload' | 'renderer';
  platform?: Platform[];
  reason: string;               // 'builtin' | 'plugin:@acme/dialog' | 'tsconfig-paths'
}

interface FeatureBinding  { api: string; module: string; source: string; override?: boolean }
interface PolyfillBinding { builtin: string; module: string; mode: 'replace' | 'augment'; variant: 'js' | 'native'; source: string }
interface BootTask        { id: string; order: number; module: string; source: string }
interface SlotBinding     { slot: string; component: string; priority: number; source: string }
interface PlannedFile     { path: string; source: 'template' | 'generated' | 'plugin'; template?: string }
interface FilePatch       { file: string; op: 'json-merge' | 'text-append' | 'replace'; value: unknown }
```

`source` 字段记录"这条贡献从哪来"（`builtin` / `plugin:<name>` / `project`），写进 `plan.json` 后可以回答"为什么这个模块被映射到这里"。

plan 阶段的四项检查：

1. **完整性**：每个入口都存在；每个 `to` 都能 resolve（本地路径存在 / 包已安装）。
2. **冲突**：同一 `from` 出现两条不同 `to` → 按优先级取一条并 `warnings.push`；同优先级 → 报错。
3. **可达性**：入口 → 依赖图是否闭合；`unreachable` 文件是否被误当作入口。
4. **能力闭合**：所有 `error` 级 finding 是否已被 `resolves` 覆盖（含证据）。

`e2rn convert --dry-run` 输出 plan 摘要 + 文件清单 + 警告，不写磁盘。

## 5. emit：只写胶水

### 5.1 产物清单

| 产物 | 来源 | 说明 |
|---|---|---|
| `index.js` | 模板 + plan | 启动序列（[01](01-architecture.md) §3） |
| `metro.config.js` | 模板 + plan | 引用 `@e2rn/metro-preset`，注入 `resolve-map.json` |
| `babel.config.js` | 模板 + plan | 按需启用语法降级插件 |
| `app.json` / `package.json` | 模板 + plan | 名称、bundle id、依赖 |
| `src/App.tsx` | 模板 | 只有 `WindowManager` 与诊断页 |
| `src/runtime/boot.ts` | **生成** | 有序启动任务 |
| `src/runtime/loadMain.ts` | **生成** | 动态 `require` 用户主进程入口 |
| `src/runtime/feature-registry.ts` | **生成** | 插件/内置 feature 的静态 import 与注册 |
| `src/runtime/preload/*.js` | **生成** | 用户 preload 打成 IIFE 后的注入脚本 |
| `.e2rn/*` | 生成 | plan / resolve-map / report / verify |
| `android/` `ios/` | 模板 | RN 原生宿主工程（bare 模板，首次生成时写入） |
| `MIGRATION_GUIDE.md` `E2RN_TODOS.md` | 生成 | 面向人的行动清单 |

### 5.2 非侵入保证

```js
// metro.config.js（生成）
module.exports = createE2RNConfig({
  projectRoot: __dirname,
  electronRoot: path.resolve(__dirname, '..'),   // 用户工程，只读
  resolveMap: require('./.e2rn/resolve-map.json')
});
```

- **不复制**用户源码。`watchFolders` 指向 `electronRoot`，Metro 直接读原文件。
- **不改写**用户源码。所有重定向在 resolver 层完成。
- **不覆盖**非生成物。emit 前检查文件头是否含 `@e2rn-generated` 标记；没有标记且内容不同 → 跳过并警告。
- **可重复执行**。同一输入两次 emit 产物字节一致（时间戳只进 report，不进代码）。

### 5.3 可选的原生加速与源码复制

有两个"默认关闭、由用户在 `e2rn.config.ts` 显式开启"的选项。它们影响生成工程的依赖与可交付性，所以不放在默认路径上。

#### 原生加速（`native`）

> 这里的 `native` 指"用原生代码实现某个 Node 模块"，**不是**"生成 android/ios 宿主工程"。后者由模板负责，默认就会生成。

有些内置模块同时存在两种实现：

| 实现 | 特点 | 代价 |
|---|---|---|
| 纯 JS polyfill（默认） | 零原生依赖、两端一致、构建最稳 | 大文件/高频计算时性能一般 |
| 原生实现 | 性能更好（如哈希、加解密、压缩） | 需要安装原生包、重新编译、两端分别适配 |

配置：

```ts
export default {
  native: {
    strategy: 'js',                    // 默认：只用纯 JS
    // strategy: 'native',             // 全局优先原生（有则用）
    // strategy: 'auto',               // 按平台与包可用性选择
    modules: {
      crypto: 'native',                // 只给 crypto 开原生
      zlib: 'js'
    },
    packages: {
      crypto: 'react-native-quick-crypto'
    },
    deny: ['some-unmaintained-crypto']
  }
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `strategy` | `js` | `js` 纯 JS；`native` 优先原生；`auto` 有则用、无则回退 |
| `modules` | `{}` | 逐模块覆盖，优先级最高 |
| `packages` | `{}` | 指定模块使用哪个原生包；留空用插件/内置推荐 |
| `allow` / `deny` | `[]` | 包级白/黑名单，`deny` 优先 |

规则：

- 选择结果写入 `plan.json` 的 `polyfills[].variant`（`js` / `native`）与报告，用户能看出每个模块最终用了什么。
- 切到 `native` 会自动把对应包加入生成工程的 `dependencies`，并在 `MIGRATION_GUIDE.md` 标注"需要原生构建"。
- 原生实现不可用时**不回退**到 JS（除非 `strategy: 'auto'`），而是 plan 阶段报错——避免"以为开了原生，其实跑的是 JS"。
- 插件可以为一个模块同时提供 JS 与原生两种实现（见 [04](04-plugins.md) §5.3），由这里的配置决定选哪个。

#### 源码复制（`vendor`）

```ts
export default {
  vendor: {
    enabled: false,          // 默认：通过 watchFolders 引用原工程
    mode: 'copy',            // copy 可交付；symlink 仅开发
    include: ['src/**'],
    exclude: ['**/*.test.ts']
  }
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `enabled` | `false` | 开启后把 Electron 源码复制/链接进生成工程 |
| `mode` | `copy` | `copy` 用于交付独立工程；`symlink` 仅本机开发 |
| `include` / `exclude` | 全量 | 控制复制范围，避免把构建产物带进去 |

开启 `vendor` 的代价（必须写进报告）：

- 相对路径、`__dirname`、`require.resolve` 的基准变了，需要额外重写；
- 两份事实源：原工程更新后，生成物不会自动跟随；
- Metro 的 `watchFolders` 需要重新指向 `vendor/` 目录，否则热更的是旧路径。

所以默认关闭；只有"必须交付一个可独立带走的 RN 工程"时才建议开启。

## 6. 构建集成：Metro 与 Babel

### 6.1 Metro：解析层映射

`@e2rn/metro-preset` 做四件事：

1. **watchFolders**：纳入 `electronRoot` 及 workspace 根。
2. **extraNodeModules + resolveRequest**：应用 `resolve-map.json`；处理 `node:` 前缀、子路径（`fs/promises`）、`original-fs`。
3. **sourceExts**：`ts/tsx/js/jsx/json/cjs/mjs`。
4. **blockList**：排除构建产物（`out/`、`dist/`、`out-web/`、各扩展的 `node_modules`），否则 Metro 会扫描数万个无关文件。

> `plan.json` 里的 `resolveMap` 是数组（保序、可读、便于 diff）；emit 时转成以 `from` 为键的对象写入 `.e2rn/resolve-map.json`，供 resolver 做 O(1) 查找。重复键在转成对象时已由 plan 阶段消除。

```js
resolveRequest: (context, moduleName, platform) => {
  const request = moduleName.startsWith('node:') ? moduleName.slice(5) : moduleName;
  const mapped = resolveMap[request];
  if (mapped) return context.resolveRequest(context, mapped, platform);

  try {
    return context.resolveRequest(context, request, platform);
  } catch (error) {
    // NodeNext：./foo.js 实际是 foo.ts
    if (request.startsWith('.') && /\.(m?js)$/.test(request)) {
      const base = request.replace(/\.(m?js)$/, '');
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
        try { return context.resolveRequest(context, base + ext, platform); } catch {}
      }
    }
    throw error;
  }
}
```

### 6.2 Babel：只做语法降级

| 插件 | 解决的问题 | 触发条件 |
|---|---|---|
| `import.meta` → 全局 | Hermes 不解析 `MetaProperty` | 检测到 `import.meta` |
| 动态 `import(expr)` → rejected promise | Metro collector 遇到非字面量直接抛错 | 检测到非字面量 `import()` |
| 参数装饰器重写 | RN preset 的 `transform-typescript` 会擦掉构造器参数装饰器 | 检测到 `@inject` 风格写法 |
| `using` / `await using` | RN preset 未启用 explicit resource management | 检测到 `using` |
| class static block | 部分 vendor 代码使用 | 检测到 `static {` |
| `inlineRequires: false` | 默认的惰性 require 会改变 ESM 求值顺序，导致模块初始化顺序错乱 | 工程含副作用初始化（图标注册、schema 注册） |

> `inlineRequires` 是**真实踩过的坑**：某工程在模块顶层先计算派生常量、再 require 依赖库，惰性 require 让依赖库的注册晚于使用，直接抛 "references an unknown codicon"。这类问题不会在扫描阶段暴露，只会在运行时炸，所以默认关闭。

> 动态 `import(expr)` 的改写只是"让构建能过"的最后手段：改写后该分支在运行时会 reject。只对**确认不可达**的分支启用；可达分支应改为静态 import，或按 §2.5 显式暴露给用户。

### 6.3 两个真实解析陷阱

**`browser` 字段**：Metro 尊重 `package.json#browser`，会把 `pkg` 解析到浏览器构建。若某依赖的 Node 构建才有需要的导出（例如某 JSON-RPC 库的 `StreamMessageWriter` 只在 `lib/node` 里），浏览器构建会得到 `undefined`，报 "Super expression must either be null or a function"。

处理：`resolve-map.json` 支持 `forceEntry`：

```json
{ "some-jsonrpc": { "forceEntry": "node_modules/some-jsonrpc/lib/node/main.js" } }
```

**`exports` 字段**：Node 的 `exports` 条件（`node` / `browser` / `import` / `require`）与 Metro 的解析不完全一致。遇到 `ERR_PACKAGE_PATH_NOT_EXPORTED` 时，按真实文件路径直连，不要试图改用户代码。

## 7. verify：三级验证

| 级别 | 命令 | 检查什么 | 典型失败 |
|---|---|---|---|
| `resolve`（默认） | `e2rn convert` | 模块图每个说明符都能解析 | 映射表漏了子路径；包未安装 |
| `bundle` | `--verify bundle` | 真正打一次 release bundle | 语法不支持；collector 拒绝动态 import；内存不足 |
| `smoke` | `npm start` + `npm run android` | 启动 → ready → 首窗口 → 一次 IPC 往返 | 环境指纹不对；preload 未注入；资源服务未起 |

`verify.json`：

```json
{
  "level": "resolve",
  "ok": false,
  "checkedAt": "2026-11-24T12:00:00Z",
  "unresolved": [
    { "specifier": "original-fs", "from": "src/main/file.js", "reason": "no mapping" }
  ],
  "warnings": []
}
```

失败时**保留产物**——用户需要在真实工程里继续调试，清空反而增加成本。

## 8. 幂等、增量与回滚

- **幂等**：emit 基于 plan 全量计算目标内容，再与磁盘比对，只写差异。重复执行不产生变更。
- **增量**：`npm start` 的 Metro 通过 `watchFolders` 监听 `electronRoot`，源码变更走 HMR；只有入口/配置/插件变更才需要重跑 `e2rn convert`。
- **回滚**：emit 前把将被覆盖的生成物记录到 `.e2rn/backup/<timestamp>/`；`e2rn restore` 可回退。用户文件不入备份（因为从不覆盖）。

## 9. 失败处理矩阵

| 场景 | 是否中止 | 用户看到什么 |
|---|---|---|
| 配置缺失/路径不存在 | 是 | 明确缺失项 + `e2rn init` 提示 |
| 入口解析失败 | 是 | 尝试过的候选路径列表 |
| 单文件语法解析失败 | 否 | `project.parse-failures`，标注"覆盖度不足" |
| 存在 `error` finding | 是（除 `--force`） | 报告路径 + 前三条摘要 + 修复建议 |
| 插件加载失败 | 否（strict 模式中止） | `plugin.load-error` finding |
| 映射冲突 | 是 | 冲突双方来源（内置/哪个插件）+ 优先级建议 |
| verify 失败 | 否 | 失败清单 + 复现命令 |
| 目标文件已存在且非生成物 | 否 | 跳过并列入"未覆盖文件" |

## 10. 性能预算（参考）

以 1 万文件量级的工程为基准：

| 阶段 | 目标 | 手段 |
|---|---|---|
| scan | < 60s | `@swc/core` 做语法层，`ts-morph` 只用于需要类型信息的少数文件；文件内容懒加载 |
| classify | < 2s | 纯内存规则匹配 |
| plan | < 1s | 纯数据计算 |
| emit | < 5s | 只写胶水，不复制大树 |
| verify(resolve) | < 10s | 复用 Metro resolver，不启动打包 |
| verify(bundle) | 5–15min | 受工程规模影响，默认不跑 |

scan 超过预算时，优先降级"语义层"（成员级 API 追踪），保留"语法层"（模块级），并在报告里标注精度下降。
