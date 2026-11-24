# 05 · 插件开发指南

> 面向第一次写 E2RN 插件的人。读完前两节就能跑通一个最小插件；后面按场景查代码。
> 规范与类型定义见 [04-plugins.md](04-plugins.md)。

## 0. 五分钟：最小插件

```bash
# 1. 生成脚手架
e2rn plugin create @acme/e2rn-plugin-dialog --template api

# 2. 装到当前工程
e2rn plugin add ./e2rn-plugin-dialog

# 3. 看它有没有被加载
e2rn plugin list

# 4. 跑检测，确认规则/映射生效
e2rn check --trace plugin
```

生成的目录：

```text
e2rn-plugin-dialog/
├── package.json
├── src/index.ts          # 你唯一必须改的文件
├── fixtures/basic-app/   # 证据工程（可先留空）
└── test/contract.test.ts
```

`src/index.ts`：

```ts
import { definePlugin } from '@e2rn/plugin-kit';

export default definePlugin({
  name: '@acme/e2rn-plugin-dialog',
  version: '0.0.1',
  apiVersion: 1,
  contributes: {},
  hooks: {}
});
```

`e2rn plugin add` 会把插件写进配置（也可手写）：

```ts
// e2rn.config.ts
export default {
  electronProjectPath: '.',
  outputPath: './rn-app',
  plugins: [
    '@acme/e2rn-plugin-dialog',     // 已安装的包
    './local/e2rn-plugin-guard'     // 本地路径，便于开发
  ]
};
```

最小可用插件的判据：`e2rn plugin list` 能看到它，且 `e2rn convert --dry-run` 的 `plan.json` 里出现它的名字（在 `resolveMap[].reason` 或 `files[].source`）。

---

## 1. 场景 A：补一个 Electron API（`dialog`）

这是最常见的插件。四步：**实现对象 → 注册 feature → 声明 UI 宿主 → 声明能力与证据**。

### 1.1 实现

```ts
// src/runtime/dialog.ts
import { Alert } from 'react-native';
import { runtime } from '@e2rn/runtime';

type OpenDialogOptions = {
  properties?: string[];
  filters?: Array<{ name: string; extensions: string[] }>;
};
type OpenDialogReturnValue = { canceled: boolean; filePaths: string[] };

function normalize(args: unknown[]) {
  // Electron 支持 showMessageBox(win, opts) 与 showMessageBox(opts)
  return (args.length >= 2 ? args[1] : args[0]) as Record<string, any>;
}

export const dialog = {
  async showMessageBox(...args: unknown[]) {
    const opts = normalize(args);
    const buttons: string[] = opts.buttons ?? ['OK'];
    const response = await runtime.ui.choice({
      title: opts.title ?? '',
      message: opts.message ?? '',
      detail: opts.detail,
      buttons,
      cancelId: opts.cancelId ?? buttons.length - 1
    });
    return { response, checkboxChecked: false };
  },

  showMessageBoxSync() {
    throw new Error(
      '[e2rn] dialog.showMessageBoxSync() is not supported on mobile: ' +
      'no blocking UI thread. Use await dialog.showMessageBox() instead.'
    );
  },

  async showOpenDialog(...args: unknown[]): Promise<OpenDialogReturnValue> {
    const opts = normalize(args) as OpenDialogOptions;
    const files = await runtime.native.pickFiles({
      multiple: opts.properties?.includes('multiSelections'),
      types: opts.filters?.map((f) => f.extensions).flat()
    });
    return { canceled: files.length === 0, filePaths: files };
  },

  async showSaveDialog() {
    throw new Error(
      '[e2rn] dialog.showSaveDialog() has no mobile equivalent. ' +
      'Write into the sandbox and open the share sheet instead.'
    );
  },

  showErrorBox(title: string, content: string) {
    Alert.alert(title, content);
  }
};

export default dialog;
```

`runtime.ui.choice` / `runtime.native.pickFiles` 由运行时提供；插件只声明能力，不直接依赖具体 UI 库，这样换 UI 实现时插件不用改。

### 1.2 注册

```ts
// src/index.ts
import { definePlugin } from '@e2rn/plugin-kit';

export default definePlugin({
  name: '@acme/e2rn-plugin-dialog',
  version: '0.3.0',
  apiVersion: 1,
  displayName: 'Dialog',
  engines: { e2rn: '^0.2.0', rn: '>=0.74', platforms: ['android', 'ios'] },

  contributes: {
    electron: [
      {
        api: 'dialog',
        module: './runtime/dialog.ts',
        override: true,       // 基础运行时已有简版，需显式覆盖
        members: { missing: ['showMessageBoxSync', 'showOpenDialogSync', 'showSaveDialogSync'] }
      }
    ],
    // 让 messageBox 有自己的渲染宿主（可选；不写则用运行时默认 Modal）
    ui: [{ slot: 'dialog.host', component: './ui/DialogHost.tsx', priority: 100 }],
    native: [{ kind: 'npm', name: '@react-native-documents/picker' }]
  },

  resolves: [
    {
      rule: 'electron-api.dialog.showMessageBox',
      level: 'full',
      note: '自绘 Modal，支持 buttons / defaultId / cancelId',
      evidence: { fixture: 'fixtures/basic-app', verify: 'test/evidence/message-box.json' }
    },
    {
      rule: 'electron-api.dialog.showOpenDialog',
      level: 'partial',
      note: '返回 URI，使用前需复制进沙盒；不支持 filters 之外的属性'
    }
  ]
});
```

> `ui.dialog.host` 是可选的：不提供时用运行时默认 Modal。自定义宿主的写法与场景 C 的标题栏相同（默认导出组件，通过 `runtime.ui` 拿到待显示的对话框队列）。

### 1.3 验证生效

```bash
e2rn check --trace plugin        # 日志里应出现 feature 装配与 resolve 命中
e2rn convert --dry-run           # plan.json 的 features 里出现 dialog
```

打开 `src/runtime/feature-registry.ts`，应看到：

```ts
import dialog from '@acme/e2rn-plugin-dialog/runtime/dialog';
export const features = { ...base.features, dialog };
```

### 1.4 证据工程

```text
fixtures/basic-app/
├── package.json          # main: main.js, devDependencies.electron
├── main.js               # new BrowserWindow + dialog.showMessageBox
├── preload.js
└── index.html
```

`e2rn plugin verify` 会对它跑一遍扫描，断言 `electron-api.dialog.showMessageBox` 不再以 `error` 出现。没有这个 fixture，你的 `full` 声明只会降级成 `warn`（见 [04](04-plugins.md) §8）。

---

## 2. 场景 B：只加一条检查规则

```ts
// src/index.ts
import { definePlugin } from '@e2rn/plugin-kit';

export default definePlugin({
  name: '@acme/e2rn-plugin-guard',
  version: '0.1.0',
  apiVersion: 1,
  contributes: {
    rules: [
      {
        id: 'broadcast-channel',
        title: '检测到 BroadcastChannel 跨窗口通信',
        severity: 'warn',
        roles: ['renderer'],
        description: '多个 WebView 之间不共享同源上下文，BroadcastChannel 无法跨窗口通信。',
        suggestion: '改用主进程 EventBus 中转（ipcRenderer.send + ipcMain 广播）。',
        detect(ctx) {
          const hits = [];
          for (const file of ctx.files) {
            if (file.role !== 'renderer') continue;
            const text = file.text();
            const idx = text.search(/new\s+BroadcastChannel\s*\(/);
            if (idx < 0) continue;
            hits.push({
              filePath: file.path,
              relativePath: file.relativePath,
              line: text.slice(0, idx).split('\n').length,
              column: 1,
              role: 'renderer' as const
            });
          }
          return hits;
        }
      }
    ]
  }
});
```

要点：

- 先按 `role` 过滤，再读内容——不要一上来 `ctx.files.map(f => f.text())`。
- `id` 不含点号，会自动补上规则前缀：`@acme/e2rn-plugin-guard` + `broadcast-channel` → `acme.guard.broadcast-channel`（报告里能看到）。
- 返回 `true` 表示"文件级命中但无具体位置"，报告会显示文件而不给行列。

---

## 3. 场景 C：替换窗口标题栏

```tsx
// src/ui/TitleBar.tsx
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function TitleBar({ windowId, runtime, actions }) {
  const win = runtime.getWindow(windowId);
  if (!win) return null;
  return (
    <View style={styles.bar}>
      <Text style={styles.title} numberOfLines={1}>{win.title || runtime.appName}</Text>
      <View style={styles.actions}>
        <Pressable onPress={() => actions.minimize(windowId)} hitSlop={8}>
          <Text style={styles.btn}>—</Text>
        </Pressable>
        <Pressable onPress={() => actions.close(windowId)} hitSlop={8}>
          <Text style={styles.btn}>×</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, backgroundColor: '#1f1f1f' },
  title: { flex: 1, color: '#ddd', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 16 },
  btn: { color: '#bbb', fontSize: 16 }
});
```

```ts
contributes: {
  ui: [{ slot: 'window.titleBar', component: './ui/TitleBar.tsx', priority: 150 }]
}
```

注意：

- 组件不能 import `@e2rn/electron`（循环依赖），窗口数据从 `runtime.getWindow()` 读，操作走 `actions`。
- 手机全屏模式下标题栏默认隐藏；插件只在 `stack` / `desktop` 模式或平板上有意义。要在全屏也显示，用 `runtime.config.ui.forceTitleBar`。
- 安全区（刘海、手势条）由 `Window` 容器统一处理，组件内不要再加 `SafeAreaView`。

---

## 4. 场景 D：补一个 Node 内置模块（同步 `fs`）

同步 `fs` 是纯 JS 做不到的（RN 的文件 API 是异步的）。要支持，只能引入原生模块。**这是一个高级示例**，重点看声明方式。

```ts
// src/runtime/fs-sync.ts
import { NativeModules } from 'react-native';

const native = NativeModules.E2RNfsSync as {
  readFileSync(path: string, encoding: string): string;
  existsSync(path: string): boolean;
  statSync(path: string): { size: number; mtimeMs: number; isDirectory(): boolean };
};

function assertSandbox(p: string) {
  if (!p.startsWith('/data/') && !p.startsWith('/var/')) {
    throw new Error(`[e2rn] fs sync access outside sandbox is not allowed: ${p}`);
  }
}

export const readFileSync = (p: string, enc: string = 'utf8') => {
  assertSandbox(p);
  return native.readFileSync(p, enc);
};
// existsSync / statSync / readdirSync 同理
```

```ts
contributes: {
  node: [{
    builtin: 'fs',
    module: './runtime/fs-sync.ts',
    mode: 'augment',          // 只补同步 API，保留内置异步实现
    install: 'none',
    limitations: ['仅支持沙盒内路径', '不提供 createReadStream / watch']
  }],
  native: [
    { kind: 'android-gradle', line: "implementation project(':e2rn-fs-sync')" },
    { kind: 'android-permission', name: 'android.permission.READ_EXTERNAL_STORAGE', maxSdk: 32 },
    { kind: 'ios-pod', name: 'E2RNfsSync', version: '~> 0.1' }
  ]
},
resolves: [
  {
    rule: 'builtin.fs',
    level: 'partial',
    note: '在异步实现之上补齐同步 API（需原生模块）'
  },
  {
    rule: 'builtin.fs.sync',
    level: 'partial',
    note: '仅同步读/存在性/stat，需安装原生模块',
    evidence: { fixture: 'fixtures/fs-read-config' }
  }
]
```

规则：

- `mode: 'augment'` 只做浅合并；要改已有成员的行为请用 `replace`，并承担回归风险。
- `limitations` 会原样进报告，写清楚边界比写"已支持"更有用。
- 原生模块要同时声明 Android 权限与 iOS 用法说明，否则上架被打回。
- 不要覆盖内置的异步 `fs`；只补同步 API，保持行为一致。

---

## 5. 场景 E：修正一个第三方包的解析

真实症状：某包在 Metro 下被解析到浏览器构建，导出缺失，运行时报 `Super expression must either be null or a function`。

```ts
contributes: {
  moduleMap: [
    {
      from: 'some-sdk',
      to: 'some-sdk',
      forceEntry: true,        // 绕过 package.json 的 browser 字段
      note: 'Node 构建才有 StreamMessageWriter'
    },
    {
      from: 'some-sdk/node',
      to: 'some-sdk/lib/node/main.js',
      forceEntry: true
    }
  ]
}
```

如果包内路径需要精确指向文件：

```ts
{ from: '@acme/protocol', to: './vendor/protocol-node.js', scope: 'main' }
```

注意：

- 优先 `forceEntry`，其次 `to` 指向包内文件；最后才考虑 vendor 一份（会失去上游更新）。
- `subpaths: true` 会把 `from/*` 一并映射，适合 `sdk/a`、`sdk/b` 这种结构。
- 改完用 `e2rn convert --dry-run --verify resolve` 确认没有未解析说明符。

---

## 6. 场景 F：声明一个子进程入口（仅 Android）

```ts
contributes: {
  children: [{
    id: 'pty-host',
    entry: './children/ptyHost.ts',
    bundle: 'children/ptyHost',
    match: {
      modulePath: 'app/terminal/node/ptyHostMain',
      env: { APP_ESM_ENTRYPOINT: 'app/terminal/node/ptyHostMain' }
    }
  }]
}
```

对应的入口文件必须自包含：

```ts
// src/children/ptyHost.ts
import { runChildMain } from '@e2rn/runtime/child';

runChildMain({
  key: 'pty-host',
  load: () => require('../../user-src/platform/terminal/node/ptyHostMain')
});
```

检查清单：

- `bundle` 全局唯一；emit 后应在 `children/` 下看到入口文件，且 `plan.json` 的 `entries.children` 包含它。
- 只 import 子进程需要的模块。把主进程入口拖进来会让每个子进程都下载并解析整张图。
- iOS 上不会生成该入口，报告会出现 `plugin.platform-unsupported`（预期行为）。

---

## 7. 场景 G：为内置模块提供原生加速变体（`crypto`）

有些模块同时有"纯 JS polyfill"和"原生快速实现"。插件负责**声明两种实现**，用哪个由用户在 `e2rn.config.ts` 决定。

```ts
// src/runtime/crypto-js.ts —— 纯 JS（默认）
export * from 'crypto-browserify';

// src/runtime/crypto-native.ts —— 原生加速
export * from 'react-native-quick-crypto';
```

```ts
contributes: {
  node: [{
    builtin: 'crypto',
    module: './runtime/crypto-js.ts',
    native: {
      module: './runtime/crypto-native.ts',
      package: 'react-native-quick-crypto',
      note: '哈希/加解密更快；包体增大，部分算法缺失'
    }
  }],
  native: [{ kind: 'npm', name: 'react-native-quick-crypto' }]
}
```

用户的配置：

```ts
// e2rn.config.ts
export default {
  native: {
    strategy: 'js',                    // 默认纯 JS
    modules: { crypto: 'native' }      // 只为 crypto 开原生
  }
};
```

规则：

- 插件**不能**自行切换实现，只声明 `native` 变体；选择权在配置。
- 声明了 `native` 就必须同时声明 npm 依赖，否则 plan 报错。
- 未启用的变体不会被打进 bundle，也不会写进生成工程的 `dependencies`。
- 两端行为差异写进 `note`；没有对应原生实现时不做静默回退（除非 `strategy: 'auto'`）。
- 验证：`e2rn check` 的报告里看 `variant`；`e2rn convert --dry-run` 的 `plan.polyfills[].variant` 应是 `native`。

---

## 8. 调试

| 手段 | 用法 |
|---|---|
| 看插件是否加载 | `e2rn plugin list --json`，或 `e2rn check --trace plugin` |
| 看贡献落到哪 | 打开 `.e2rn/plan.json`，搜插件名：`resolveMap[].reason`、`files[].source` |
| 看规则是否命中 | `e2rn check --json \| jq '.findings[] \| select(.id\|startswith("acme.guard."))'` |
| 只跑某个插件 | `e2rn check --plugin ./e2rn-plugin-dialog` |
| 详细日志 | `E2RN_DEBUG=plugin:* e2rn convert --dry-run` |
| 断点 | `node --inspect-brk $(which e2rn) check`，Chrome `chrome://inspect` |
| 运行期验证 | `npm start` + `npm run android`，看 `[e2rn]` 前缀日志与 `verify.json` |

常见现象与原因：

| 现象 | 原因 |
|---|---|
| 插件列表里没有 | `e2rn.config.ts` 的 `plugins` 没写；或包没装；或 `apiVersion` 不匹配 |
| 规则不命中 | `roles` 过滤掉了；文件不在入口链路（`unreachable`）；`detect` 抛异常被吞（看 `plugin.rule-error`） |
| feature 没生效 | 忘了 `e2rn convert`；或 `override: false` 与内置冲突被拒；或 API 名拼错 |
| UI 没出现 | 槽名不在白名单；优先级低于默认实现；当前窗口模式不渲染该槽 |
| 映射没生效 | `from` 写了通配符（只支持精确匹配 + `subpaths`）；子路径未单独声明 |

---

## 9. 测试与证据

```ts
// test/contract.test.ts
import { describe, expect, it } from 'vitest';
import { runPluginContract } from '@e2rn/plugin-kit/testing';
import plugin from '../src';

describe('dialog plugin', () => {
  it('passes the contract', async () => {
    const result = await runPluginContract(plugin, {
      fixture: 'fixtures/basic-app',
      expect: {
        resolved: ['electron-api.dialog.showMessageBox'],
        findings: { 'plugin.load-error': 0 }
      }
    });
    expect(result.ok).toBe(true);
  });
});
```

`runPluginContract` 会做：

1. schema 校验（贡献点字段、路径、ID）；
2. 对 fixture 执行 scan + classify（不写文件）；
3. 断言 `resolves` 声明的规则确实被降级；
4. 检查冲突（与内置、与其它已声明插件）；
5. 生成 `plugin-verify.json` 作为证据。

发布前跑：

```bash
pnpm test
e2rn plugin verify ./e2rn-plugin-dialog
```

---

## 10. 发布

命名与元数据：

- 官方插件：`@e2rn/plugin-<name>`；社区插件：`e2rn-plugin-<name>` 或 `@scope/e2rn-plugin-<name>`；
- `keywords` 必须含 `e2rn-plugin`；
- `peerDependencies` 声明 `@e2rn/plugin-kit` 与 `@e2rn/runtime`；
- README 至少包含：解决的规则 ID、支持/不支持的成员、原生依赖、已知限制、fixture 说明。

版本：

- 补成员、修 bug → patch；
- 新增贡献点/规则/槽实现 → minor；
- 改已有行为或删除能力 → major（同时更新 `resolves` 的 `note`）；
- `apiVersion` 只在插件 API 破坏性变更时跟随宿主升级。

弃用：

```ts
export default definePlugin({
  // ...
  deprecated: {
    since: '0.4.0',
    message: '运行时已内置 dialog 实现',
    replacement: '@e2rn/plugin-dialog'
  }
});
```

宿主会打印提示，但不会阻止加载（给用户迁移时间）。

---

## 11. API 速查

| 我要… | 用哪个 |
|---|---|
| 把某个模块指向别的实现 | `contributes.moduleMap` |
| 实现/替换一个 Electron API | `contributes.electron` + `resolves` |
| 提供 Node 内置模块 | `contributes.node` |
| 补环境指纹（process/navigator） | `contributes.env` |
| 换标题栏/菜单/对话框宿主 | `contributes.ui` |
| 往 WebView 注入脚本 | `contributes.renderer` |
| 加 npm 依赖/权限/Info.plist | `contributes.native` |
| 增加子进程入口 | `contributes.children` |
| 加一条检查规则 | `contributes.rules` |
| 在报告里加一节 | `contributes.report` |
| 扫描后修正事实 | `hooks.onScan` |
| 写文件前改计划 | `hooks.onPlan` |
| 改生成文件内容 | `hooks.onEmit` |
| 报告汇总时加注记 | `hooks.onReport` |
| 验证后追加检查 | `hooks.onVerify` |
| 加载时读配置/校验环境 | `hooks.setup` |
