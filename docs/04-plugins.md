# 04 · 插件架构

> 这一章是插件系统的规范。目标只有一个：**插件作者只学一套模型，就能扩展转换链路的任何一环。**
> 上手教程见 [05-plugin-guide.md](05-plugin-guide.md)。

## 1. 设计目标

| 目标 | 具体要求 |
|---|---|
| **一个形状** | 所有插件都是 `definePlugin({ ... })`，没有互斥的"插件类型" |
| **声明优先** | 80% 的插件只写配置（映射、规则、UI 槽、原生依赖），不写生命周期代码 |
| **可组合** | 一个插件可以同时补 API、加规则、加原生依赖、换标题栏 |
| **可验证** | 能力声明必须带证据；没有证据的声明不能改变结论 |
| **可演进** | 贡献点有 schema 与 `apiVersion`；新增不破坏旧插件 |

## 2. 概念模型

```text
Plugin
├── manifest        身份、版本、兼容范围、依赖
├── contributes     向固定插槽投递实现（声明式，10 个贡献点）
├── hooks           在流水线 6 个节点做增量修改（可选）
└── resolves        声明解决了哪些内置规则 + 证据
```

| 概念 | 定义 | 谁消费 |
|---|---|---|
| **Contribution（贡献点）** | 插件提供给某个环节的"东西"：一条映射、一个 API 实现、一个组件、一条规则 | plan / emit / runtime |
| **Hook（钩子）** | 插件在某个阶段的回调，接收上下文、返回 patch | 流水线 |
| **Capability（能力声明）** | "我解决了规则 X，覆盖程度是 full/partial"，并附证据 | classify / report |
| **Feature** | `@e2rn/electron` 内部按 API 拆分的实现单元（`app`、`dialog`…） | 运行时 |
| **Slot** | 运行时可替换的 UI 位置 | WindowManager |
| **Rule** | 报告中的一条风险判定 | check / convert |

**没有 `type` 字段。** 插件的身份由它贡献了什么决定，而不是由作者给自己贴的标签决定。

```text
Plugin = manifest + contributes + hooks + resolves

  构建期（CLI / Node）                          运行期（设备）
  moduleMap ──► plan.resolveMap                 electron ──► feature registry
  native    ──► plan.native                     node     ──► module map / globals
  children  ──► plan.entries.children            env      ──► boot installers
                                                ui       ──► slot registry
                                                renderer ──► injected scripts

  rules ──► findings ──► report ◄── report sections
```

同一个插件可以同时出现在左右两侧：`dialog` 插件既贡献运行期的 API 实现，也贡献分析规则与报告说明。

## 3. 包结构

```text
e2rn-plugin-dialog/
├── package.json           # name / exports / peerDependencies
├── src/
│   ├── index.ts           # definePlugin(...) —— 唯一入口
│   ├── runtime/
│   │   └── dialog.ts       # Electron feature 实现（默认导出 API 对象）
│   ├── ui/
│   │   └── DialogHost.tsx  # 可选：UI 插槽组件
│   └── renderer/
│       └── patch.ts        # 可选：注入到 WebView 的脚本
├── fixtures/
│   └── basic-app/          # 证据：最小可复现工程
├── test/
│   └── contract.test.ts    # 契约测试
└── README.md
```

`package.json` 最小要求：

```json
{
  "name": "@acme/e2rn-plugin-dialog",
  "version": "0.3.0",
  "main": "dist/index.js",
  "exports": {
    ".": "./dist/index.js",
    "./runtime/*": "./dist/runtime/*",
    "./ui/*": "./dist/ui/*"
  },
  "peerDependencies": {
    "@e2rn/plugin-kit": "^0.2.0",
    "@e2rn/runtime": "^0.2.0"
  },
  "keywords": ["e2rn-plugin"]
}
```

## 4. Manifest

```ts
interface PluginDefinition {
  // 身份
  name: string;
  version: string;
  apiVersion: 1;
  displayName?: string;
  description?: string;
  author?: string;
  license?: string;
  homepage?: string;
  repository?: string;

  // 兼容与排序
  engines?: { e2rn?: string; rn?: string; platforms?: Platform[] };
  priority?: number;                 // 默认 100
  dependsOn?: string[];
  conflictsWith?: string[];
  deprecated?: { since: string; message: string; replacement?: string };

  // 能力与实现
  resolves?: ResolveClaim[];
  contributes: Contributions;
  hooks?: PluginHooks;
}

interface Contributions {
  moduleMap?: ModuleMapEntry[];
  electron?: ElectronFeatureContribution[];
  node?: NodeContribution[];
  env?: EnvPatchContribution[];
  ui?: UiContribution[];
  renderer?: RendererContribution[];
  native?: NativeRequirement[];
  children?: ChildEntryContribution[];
  rules?: AnalysisRule[];
  report?: ReportSectionContribution[];
}
```

完整示例：

```ts
import { definePlugin } from '@e2rn/plugin-kit';

export default definePlugin({
  // ---- 身份 ----
  name: '@acme/e2rn-plugin-dialog',
  version: '0.3.0',
  apiVersion: 1,
  displayName: 'Dialog',
  description: '把 Electron dialog 映射到 RN 的对话框与文件选择器',
  author: 'Acme',
  license: 'MIT',

  // ---- 兼容范围 ----
  engines: {
    e2rn: '^0.2.0',
    rn: '>=0.74',
    platforms: ['android', 'ios']
  },

  // ---- 外部依赖（统一走 contributes.native，见 §5.7）----
  // 不再单独维护 requires 字段：依赖、权限、Info.plist 只有一处声明，
  // 避免"声明了但没写进工程"或"写进了工程但报告不知道"。

  // ---- 能力声明（见 §8）----
  resolves: [
    {
      rule: 'electron-api.dialog.showMessageBox',
      level: 'full',
      note: '使用自绘 Modal，支持 buttons/defaultId/cancelId',
      evidence: { fixture: 'fixtures/basic-app', verify: 'test/evidence/message-box.json' }
    },
    {
      rule: 'electron-api.dialog.showSaveDialog',
      level: 'partial',
      note: '无"另存为路径"语义，改为写入沙盒后调起分享面板'
    }
  ],

  // ---- 贡献点（见 §5）----
  contributes: {
    electron: [{ api: 'dialog', module: './runtime/dialog.ts', override: true }],
    ui: [{ slot: 'dialog.host', component: './ui/DialogHost.tsx', priority: 100 }],
    native: [{ kind: 'npm', name: '@react-native-documents/picker' }]
  },

  // ---- 钩子（见 §6，可选）----
  hooks: {
    onReport(report, ctx) {
      report.addNote('dialog', '文件选择器返回 URI，使用前需复制进沙盒');
    }
  }
});
```

`definePlugin` 只做类型推断与浅校验；重校验在加载期（§10）。

其余可选字段：`homepage`、`repository`、`deprecated`（见 §9）、`priority`（默认 100，见 §7.3）。**没有 `type` 字段**——插件的身份由 `contributes` 决定。

| 字段 | 必填 | 说明 |
|---|---|---|
| `name` / `version` | 是 | 包名与 semver；`name` 全局唯一 |
| `apiVersion` | 是 | 插件 API 版本，当前为 `1` |
| `engines` | 建议 | 声明 `e2rn` / `rn` / `platforms`，用于加载期校验 |
| `resolves` | 建议 | 能力声明 + 证据（§8） |
| `contributes` | 是 | 至少一个贡献点，否则插件没有作用 |
| `hooks` | 否 | 需要介入流水线时使用（§6） |
| `priority` | 否 | 冲突时的排序依据，默认 100 |
| `dependsOn` / `conflictsWith` | 否 | 参与拓扑排序与冲突检测 |
| `deprecated` | 否 | 弃用提示与替代包名 |

## 5. 贡献点

十个贡献点，分四组。**只写你要用的**，其余留空。

每个贡献点都由"**冲突键 + 合并语义**"定义，规则统一：

| 贡献点 | 冲突键 | 多份声明时 |
|---|---|---|
| `moduleMap` | `from` | `priority` 高者胜；同优先级报错 |
| `electron` | `api` | 必须 `override: true` 才能覆盖 |
| `node` | `builtin` | `mode: replace \| augment`，需 `resolves` 声明 |
| `env` | `id` | 按 `order` 依次执行 |
| `ui` | `slot` | `priority` 高者胜 |
| `renderer` | `id` | 按 `priority` 依次注入 |
| `native` | `(kind, name)` | 合并去重；版本冲突报错 |
| `children` | `bundle` | 唯一，重复报错 |
| `rules` | `id` | 唯一（含内置 ID） |
| `report` | `id` | 按 `order` 排列章节 |

| 组 | 贡献点 | 生效阶段 |
|---|---|---|
| 构建 | `moduleMap` `native` `children` | plan / emit |
| 运行时 · 宿主 | `electron` `node` `env` | boot / 运行 |
| 运行时 · 渲染 | `ui` `renderer` | 运行 |
| 分析 | `rules` `report` | scan / classify / report |

### 5.1 `moduleMap` —— 模块说明符重定向

```ts
interface ModuleMapEntry {
  from: string;              // 精确说明符：'fs' | 'node:fs' | '@acme/sdk' | 'electron'
  to: string;                // 包名，或相对插件根的 './runtime/fs.ts'
  scope?: 'all' | 'main' | 'preload' | 'renderer';   // 默认 all
  platform?: Platform[];
  subpaths?: boolean;        // true 时同时映射 from/* → to/*
  forceEntry?: boolean;      // 绕过 package.json 的 browser/exports 字段
  note?: string;             // 写进 plan.json 的 reason 链
}
```

```ts
contributes: {
  moduleMap: [
    { from: 'original-fs', to: 'fs', note: 'Electron 的 original-fs 等价于 fs' },
    { from: '@acme/legacy-sdk', to: './runtime/legacy-sdk.ts', scope: 'main' },
    { from: 'some-jsonrpc', to: 'some-jsonrpc', forceEntry: true }
  ]
}
```

约束：

- `electron` 本体不可映射（保留给运行时）。
- 同一 `from` 多个插件声明 → 按优先级取一，冲突写进 plan 警告。
- `to` 为相对路径时必须落在插件目录内（防止任意路径注入）。
- `forceEntry` 只影响解析策略，不改变用户代码。

### 5.2 `electron` —— Electron 子 API 实现

```ts
interface ElectronFeatureContribution {
  api: string;               // 'dialog' | 'BrowserWindow' | 'ipcMain' | ...
  module: string;            // './runtime/dialog.ts'，默认导出该 API 对象/类
  override?: boolean;        // 覆盖内置实现必须显式声明
  members?: {
    missing?: string[];      // 明确不支持的成员（报告的成员级判定用）
    partial?: string[];      // 语义有差异的成员
  };
}
```

```ts
contributes: {
  electron: [{
    api: 'dialog',
    module: './runtime/dialog.ts',
    override: true,          // 基础运行时已有简版 dialog，显式覆盖
    members: { missing: ['showMessageBoxSync', 'showOpenDialogSync'] }
  }]
}
```

装配方式（emit 生成，静态 import，无动态 require）：

```ts
// src/runtime/feature-registry.ts（emit 生成）
import * as base from '@e2rn/electron/features';
import dialog from '@acme/e2rn-plugin-dialog/runtime/dialog';

export const features = { ...base.features, dialog };
```

`@e2rn/electron` 在求值时从注册表取值；Boot 必须先安装注册表再加载用户代码（[01](01-architecture.md) §3）。

约束：

- 基础运行时自带一批 API 的简版实现。插件实现**已存在**的 API 必须 `override: true`；实现 Electron 有、基础运行时没有的 API（如 `safeStorage`）则不需要。
- 同一个 API 只允许一个 `override` 实现；第二个覆盖者会与第一个冲突，plan 报错。
- 自定义 API 名（Electron 没有的）允许，但不会自动出现在 `electron` 命名空间，需通过 `moduleMap` 暴露。
- 实现必须是**纯对象或类**，不得在模块顶层执行副作用（会在 bootstrap 前求值）。

### 5.3 `node` —— 内置模块实现

```ts
interface NodeContribution {
  builtin: string;           // 'fs' | 'crypto' | 'net'
  module: string;            // './runtime/fs.ts'，纯 JS 实现（默认）
  mode?: 'replace' | 'augment';  // 默认 replace；augment 与内置实现浅合并
  install?: 'global' | 'none';   // 是否需要安装全局（Buffer、crypto、process 等）
  installOrder?: number;     // 越小越早，默认 100
  /** 可选的原生加速实现；是否采用由 config.native 决定 */
  native?: {
    module: string;          // './runtime/crypto-native.ts'
    package: string;         // 'react-native-quick-crypto'
    platforms?: Platform[];
    note?: string;           // 写进报告的差异说明
  };
  limitations?: string[];    // 直接进入报告的"已知限制"
}
```

```ts
contributes: {
  node: [
    {
      builtin: 'fs',
      module: './runtime/fs-sync.ts',
      mode: 'augment',       // 只补同步 API，保留内置异步实现
      install: 'none',
      limitations: ['同步 API 仅支持沙盒内路径', '不提供 watch']
    },
    {
      builtin: 'crypto',
      module: './runtime/crypto-js.ts',
      native: {
        module: './runtime/crypto-native.ts',
        package: 'react-native-quick-crypto',
        note: '哈希/加解密更快；包体增大，部分算法缺失'
      }
    }
  ]
}
```

约束：

- `augment` 只做**浅合并**（同名键以插件为准），用于补成员，不用于改行为；改行为请 `replace`。
- `native` 只是**声明变体**，是否启用由 `e2rn.config.ts` 的 `native.strategy` / `native.modules` 决定；插件不能自行切换。
- 声明了 `native` 就必须在 `contributes.native` 里声明对应的 `npm` 依赖，否则 plan 报错。
- 未启用的变体不进入 bundle，也不写进生成工程的依赖。
- `install: 'global'` 的安装函数必须幂等；重复 boot 不得重复 patch。
- 不得覆盖 `process`（由 `env` 统一管理）。
- 与内置同名时需声明 `resolves: ['builtin.<name>']`，否则 plan 阶段报"未声明覆盖"（见 §7.1）。

### 5.4 `env` —— 环境指纹补丁

```ts
interface EnvPatchContribution {
  id: string;
  order?: number;            // 默认 100
  module: string;            // 导出 apply(ctx: BootContext): void
}
```

用于补充内置指纹没覆盖的探测点（例如某个 SDK 依赖 `process.title` 或 `navigator.platform`）。

```ts
// ./runtime/env-title.ts
export function apply(ctx) {
  process.title = ctx.config.projectName;
}
```

约束：只能**新增/修正**环境字段，不能删除内置字段；补丁要写 `rationale` 进报告（在模块里导出 `rationale` 字符串）。

### 5.5 `ui` —— 界面插槽

```ts
type UiSlot =
  | 'app.root'           // 整个应用根容器（谨慎）
  | 'app.overlay'        // 全局浮层（Toast、Modal 宿主）
  | 'app.statusBar'
  | 'window.chrome'      // 窗口外框
  | 'window.titleBar'    // 标题栏
  | 'window.background'  // 窗口背景（骨架屏）
  | 'menu.application'   // 应用菜单入口
  | 'dialog.host';       // 对话框宿主

interface UiContribution {
  slot: UiSlot;
  component: string;         // './ui/TitleBar.tsx'，默认导出 React 组件
  priority?: number;         // 同槽多实现时高者胜
  mode?: 'replace' | 'compose';  // 默认 replace；compose 时依次包裹 children
  platforms?: Platform[];
}
```

组件契约（所有槽一致）：

```ts
interface SlotProps {
  windowId?: number;
  runtime: RuntimeApi;       // 只读：窗口列表、配置、平台（见 06 §16）
  actions: SlotActions;      // 受控操作：close/minimize/focus/showMenu...
}

interface SlotActions {
  close(windowId: number): void;
  minimize(windowId: number): void;
  focus(windowId: number): void;
  showMenu(anchor?: { x: number; y: number }): void;
}
```

约束：

- 组件**不得**直接 import `@e2rn/electron`（避免循环依赖），只能通过 `actions`。
- 同槽多实现：默认按优先级取最高；若声明 `mode: 'compose'`（可选）则依次包裹。
- `app.root` 只允许一个实现，且必须渲染 `children`，否则窗口无处挂载。

### 5.6 `renderer` —— 渲染层注入

```ts
interface RendererContribution {
  id: string;
  timing: 'before-content' | 'after-content';
  script?: string;           // 小段胶水（≤ 8KB）
  module?: string;           // './renderer/patch.ts'，会被打成 IIFE
  platforms?: Platform[];
}
```

注入顺序固定：`argv → ipc bridge → 内置 sandbox 兼容层 → 插件（按优先级）→ 用户 preload`。

约束：

- 注入脚本运行在 WebView 里，**没有** `require`、没有 Node。需要打包的代码用 `module`。
- 必须可重复执行（页面可能重载）：入口加 `if (window.__acme_x__) return;` 护栏。
- 不得覆盖 `window.__e2rnIpc` / `window.ReactNativeWebView`。

### 5.7 `native` —— 原生依赖与工程配置

```ts
type NativeRequirement =
  | { kind: 'npm'; name: string; version?: string; dev?: boolean }
  | { kind: 'android-permission'; name: string; maxSdk?: number }
  | { kind: 'android-gradle'; line: string }
  | { kind: 'ios-pod'; name: string; version?: string }
  | { kind: 'ios-info-plist'; key: string; value: string | boolean };
```

```ts
contributes: {
  native: [
    { kind: 'npm', name: 'react-native-fs', version: '^2.20.0' },
    { kind: 'android-permission', name: 'android.permission.POST_NOTIFICATIONS' },
    { kind: 'ios-info-plist', key: 'NSPhotoLibraryUsageDescription', value: '选择图片作为附件' }
  ]
}
```

约束：

- 只允许上述五种 `kind`，不接受任意脚本片段（`android-gradle` 仅允许单行依赖/属性）。
- 声明写进 `plan.json` 的 `native` 数组，emit 时合并去重；冲突版本报错而不是"后者覆盖"。
- iOS 的权限文案缺省会**导致上架被拒**，插件必须提供。

### 5.8 `children` —— 子运行时入口

```ts
interface ChildEntryContribution {
  id: string;
  entry: string;             // './children/ptyHost.ts'（插件内）
  bundle: string;            // 'children/ptyHost'（Metro entry 名）
  match: {
    modulePath?: string;     // 匹配 fork 的模块路径（后缀匹配）
    env?: Record<string, string>;  // 匹配 fork 时注入的环境变量
  };
}
```

约束：

- `bundle` 全局唯一；重复 → plan 报错。
- 仅 Android 生效；iOS 上声明会在报告里产生 `plugin.platform-unsupported` 警告。
- 子入口必须自包含：只 `require` 自己需要的模块，禁止 import 主进程入口。

### 5.9 `rules` —— 分析规则

```ts
interface AnalysisRule {
  id: string;                // 不含点号时自动补 <rulePrefix>.（见本节"规则前缀"）
  title: string;
  severity: 'error' | 'warn' | 'info';
  category?: FindingCategory;
  roles?: ProcessRole[];     // 角色过滤
  description: string;
  suggestion?: string;
  detect(ctx: AnalysisContext): RuleHit[] | boolean | Promise<RuleHit[] | boolean>;
}

interface AnalysisContext {
  files: Array<{ path: string; relativePath: string; role?: ProcessRole; text(): string }>;
  roles: Map<string, ProcessRole[]>;
  read(file: string): string | undefined;
  parse(file: string): unknown | undefined;   // 懒解析，成本高
  analysis: ScanResult;
  config: ResolvedConfig;
}
```

```ts
contributes: {
  rules: [{
    id: 'legacy-webview-tag',
    title: '检测到遗留 <webview> 标签',
    severity: 'warn',
    roles: ['renderer'],
    description: '移动端 WebView 不支持 <webview> 标签，需改用窗口容器。',
    detect(ctx) {
      const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length;
      return ctx.files
        .filter((f) => f.role === 'renderer')
        .flatMap((f) => {
          const idx = f.text().search(/<webview\b/i);
          if (idx < 0) return [];
          return [{ filePath: f.path, relativePath: f.relativePath, line: lineAt(f.text(), idx), column: 1, role: 'renderer' as const }];
        });
    }
  }]
}
```

约束：

- `detect` 必须**快**：只读需要的文件，不要全量 `parse`。
- 抛异常不会中断检测：转成 `<ruleId>.error` 的 `warn` finding。
- 规则 ID 发布后不得改名（见 [03](03-compatibility.md) §7）。

#### 规则前缀（rulePrefix）

插件包名到规则前缀的映射（自动推导，无需手写）：

| 包名 | rulePrefix | 规则 `foo` 的完整 ID |
|---|---|---|
| `e2rn-plugin-dialog` | `dialog` | `dialog.foo` |
| `@e2rn/plugin-dialog` | `dialog` | `dialog.foo` |
| `@acme/e2rn-plugin-dialog` | `acme.dialog` | `acme.dialog.foo` |
| `@acme/e2rn-plugin-editor-guard` | `acme.editor-guard` | `acme.editor-guard.foo` |

规则：去掉 scope 的 `@`、去掉 `e2rn-plugin-` 或 `plugin-` 前缀、把 `/` 换成 `.`。若推导结果与内置前缀冲突，加载期报错并要求改名。

### 5.10 `report` —— 报告片段

```ts
interface ReportSectionContribution {
  id: string;
  title: string;
  order?: number;
  render(ctx: ReportContext): string | void;   // 返回 Markdown
}
```

用于输出插件特有的说明（例如"本插件只覆盖了 3 个 dialog 成员"）。**不得**修改已有章节的结论数字。

## 6. 钩子

六个钩子，全部可选、全部可异步。执行顺序：依赖拓扑 → `priority` 降序 → `name` 升序。

| 钩子 | 时机 | 入参 | 可返回 | 典型用途 |
|---|---|---|---|---|
| `setup` | 插件加载后、扫描前 | `SetupContext` | `void` | 读插件配置、校验环境、准备缓存 |
| `onScan` | 扫描完成、规则判定前 | `ScanResult` | `ScanPatch` | 补充源文件、追加事实、修正角色 |
| `onPlan` | 计划生成后、写文件前 | `ConversionPlan` | `PlanPatch` | 追加映射/原生依赖/启动任务 |
| `onEmit` | 每个文件写出前 | `EmittedFile` | `EmittedFile \| void` | 改生成内容（限白名单文件） |
| `onReport` | 报告汇总后 | `ReportDraft` | `void` | 加注记、加章节、标注限制 |
| `onVerify` | 验证结束后 | `VerifyResult` | `void` | 追加检查项、失败提示 |

Patch 是**增量**，不是替换：

```ts
interface ScanPatch {
  addSourceFiles?: string[];
  addFindings?: Finding[];
  notes?: string[];
}

interface PlanPatch {
  addResolveEntries?: ResolveEntry[];
  addNative?: NativeRequirement[];
  addBootTasks?: BootTask[];
  warnings?: string[];
}
```

`onEmit` 的白名单：只能修改 `src/**`、`index.js`、`app.json`、`*.md` 与 `.e2rn/**`；**不能**改 `metro.config.js` / `babel.config.js` / `android/**` / `ios/**`（这些由贡献点驱动，直接改会绕过冲突检测）。

错误策略：

| 钩子 | 抛异常时 |
|---|---|
| `setup` | 插件标记为不可用；`plugin.load-error`；strict 模式中止 |
| `onScan` / `onPlan` | 丢弃该插件的 patch，记 `plugin.hook-error`，继续 |
| `onEmit` | 该文件回退为未修改版本，记 error，继续 |
| `onReport` | 跳过该插件章节，继续 |
| `onVerify` | 记 warning，继续 |

## 7. 解析顺序与冲突

### 7.1 模块解析优先级

```text
1. 内置 resolve-map（electron / 核心 builtin）
2. 插件 moduleMap（priority 降序，name 升序）
3. tsconfig paths / workspace 别名（由 scan 转成的内置条目）
4. Metro 默认解析（含 browser/exports）
```

- 插件可以覆盖内置 builtin，但必须同时声明 `resolves: ['builtin.<name>']`，否则 plan 阶段报"未声明覆盖"。
- `electron` 本体不可覆盖；要改行为请用 `electron` 贡献点。

### 7.2 冲突处理

| 冲突 | 处理 |
|---|---|
| 同一 `moduleMap.from` 两条不同 `to` | 取优先级高者；同优先级 → plan 报错（列出双方） |
| 同一 `electron.api` 两个实现 | 需 `override: true`；否则报错 |
| 同一 `ui.slot` 两个实现 | 取优先级高者；其余记 warning |
| 同一 `children.bundle` | 报错 |
| 同一 `rules.id` | 报错（含内置 ID） |
| 插件 A `dependsOn` B 缺失 | 插件 A 不加载，`plugin.missing-dependency` |

### 7.3 优先级约定

| 区间 | 用途 |
|---|---|
| 0–49 | 基础补丁（改默认行为，慎用） |
| 50–99 | 通用实现（社区插件默认 100 以下） |
| 100 | 默认值 |
| 101–199 | 覆盖特定实现（如替换标题栏） |
| 200+ | 应用级定制（只在具体项目中使用） |

## 8. 能力声明与证据

```ts
interface ResolveClaim {
  rule: string;                 // 内置规则 ID
  level: 'full' | 'partial';
  note: string;
  evidence?: {
    fixture?: string;           // 相对插件根的最小工程
    verify?: string;            // 证据文件（测试输出/报告快照）
    devices?: string[];         // 实测设备
  };
}
```

采纳规则（classify 阶段执行）：

| 声明 | 证据 | 效果 |
|---|---|---|
| `full` | fixture + `plugin verify` 通过 + `devices` 实测记录 | 降为 `info`，报告标注"已上机" |
| `full` | fixture + `plugin verify` 通过，无设备记录 | 降为 `info`，报告标注"未上机" |
| `full` | 无证据 | 降为 `warn`，附 `plugin.unverified-claim` |
| `partial` | 有证据 | 降一级（`error`→`warn`） |
| `partial` | 无证据 | 不降级，仅附加说明 |
| 任意 | `rule` 不存在 | `plugin.unknown-rule`（warn），声明被忽略 |

这条机制的意义：**插件可以让报告更准确，但不能让报告更乐观。**

`e2rn plugin verify` 做的事：

1. 加载插件，跑 schema 校验；
2. 对每个 `evidence.fixture` 执行 scan + classify；
3. 断言声明的规则确实不再命中（或降级到预期等级）；
4. 对比 `evidence.verify` 快照；
5. 输出 `plugin-verify.json`。

## 9. 生命周期

```text
加载期（CLI / Node）
config.plugins → resolve → import → validate → topo sort
        │
        ▼
setup → scan → onScan → classify → plan → onPlan → emit → onEmit × N
                                                          │
                                    report ◄── onReport ◄──┘
                                      │
                                   verify ──► onVerify
```

运行期不加载插件代码；插件提供的运行时代码在 emit 阶段被**静态 import** 进 `feature-registry.ts` / `boot.ts`。因此：

- 插件必须在 `dependencies` 里（不能是 `devDependencies`），否则打包时找不到；
- 插件升级后需要重新 `e2rn convert` 并重启 Metro 才会生效；
- 运行时不得依赖插件在 CLI 侧的行为（两边是不同进程、不同环境）。

## 10. 校验与错误

加载期校验清单：

| 检查 | 失败结果 |
|---|---|
| `apiVersion` 匹配宿主支持范围 | `plugin.api-version`（error，不加载） |
| `name` 唯一 | 后者不加载 |
| `engines.e2rn` / `rn` 满足 | warning，继续（可用 `--strict` 升级为 error） |
| `platforms` 与目标平台交集非空 | warning |
| 贡献点 schema（zod） | 该条贡献被丢弃 + error |
| 路径存在且在包内 | 该条贡献被丢弃 + error |
| `rules.id` 未占用 | 该规则被丢弃 + error |
| `native.kind` 在白名单 | 丢弃 + error |
| `contributes.native` 的 npm 依赖可解析 | warning（可能尚未安装） |

所有插件问题都进报告，带插件名与版本，便于定位是"工具的问题"还是"插件的问题"。

## 11. 版本演进

- `apiVersion` 是整数；**新增可选字段不升版**，删除/改语义升版。
- 宿主支持 `[N-1, N]` 两个版本，旧版插件在升级后仍可用一个大版本。
- 贡献点内的字段遵循"只增不改"：字段弃用先标 `@deprecated`，两个 minor 后移除。
- 插件可声明 `deprecated: { since, message, replacement }`，宿主在加载时打印迁移提示。

## 12. 安全边界

| 面 | 规则 |
|---|---|
| CLI 执行 | 插件在 CLI 进程内执行，拥有完整文件系统权限。**安装插件 = 信任插件**，文档需明确。 |
| 路径 | 贡献点里的相对路径必须落在插件包内；越界直接拒绝。 |
| 原生配置 | 只接受白名单 `kind`；`android-gradle` 限定单行。 |
| 运行时 | 不支持 `eval` / `new Function`（Hermes 也不支持）；插件运行时代码必须可静态打包。 |
| 注入脚本 | 只注入到本应用的 WebView；不得改写 `window.ReactNativeWebView`。 |
| 数据 | 不得读取用户工程之外的文件；不得联网（CLI 阶段默认无网络权限，除非显式声明 `network: true` 并提示用户）。 |

## 13. 从旧插件类型迁移

| 旧 `type` | 新写法 |
|---|---|
| `electron-api` | `contributes.electron` + `resolves`（+ 可选 `native`/`ui`） |
| `builtin-polyfill` | `contributes.node`（+ `env` 若需装全局） |
| `module-mapper` | `contributes.moduleMap` |
| `content-transform` | `hooks.onScan` / `hooks.onEmit`（构建期），不再对源码做字符串替换 |
| `template` | `contributes.native` + `contributes.ui` + `moduleMap`；**整包替换模板已取消** |
| `window-ui` | `contributes.ui` |
| `post-process` | `hooks.onReport` |
| `analysis-hook` | `contributes.rules` |
| `checkViable` | `resolves`（必须补 `note`，建议补 `evidence`） |

迁移提示：

- 旧 `implementation.renderer/main` 两个字段，对应 `contributes.electron`（宿主）与 `renderer`（注入）。
- 旧 `rules[]`（正则替换）不建议迁移；这类改写应由 Babel 插件在语法层完成，而不是字符串替换。
- 旧 `dependsOn` / `conflictsWith` 保留语义，参与拓扑排序与冲突检测。

## 14. 反模式

| 反模式 | 为什么错 | 正确做法 |
|---|---|---|
| 在 `renderer.script` 里 monkey patch 全局且无护栏 | 页面重载后重复 patch，行为叠加 | 加幂等标记，或用 `module` 打包 |
| 声称 `full` 但没有 fixture | 报告变绿，用户踩坑 | 提供 fixture + `plugin verify` |
| 覆盖 `electron.BrowserWindow` 却只实现一半成员 | 上层调用随机失败 | 用 `members.partial/missing` 明示，或只做包装 |
| 在 `moduleMap` 里把 `electron` 指向自己的实现 | 绕过运行时契约 | 用 `electron` 贡献点 + `override` |
| 在 `detect` 里解析全部文件 | scan 从 60s 变 10min | 先按文件名/角色过滤，再读内容 |
| 插件顶层执行副作用（写文件、联网） | 加载即产生副作用，无法 dry-run | 放到 `setup` 并尊重 `ctx.dryRun` |
| 把运行时依赖放 `devDependencies` | 生成工程打包时找不到 | 放 `dependencies` |
| 用插件改 `metro.config.js` | 绕过冲突检测，升级即碎 | 用 `moduleMap` / `native` 贡献点 |
