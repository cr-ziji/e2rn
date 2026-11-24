# 09 · 仓库与开发

## 1. 包边界

| 包 | 职责 | 运行在 |
|---|---|---|
| `@e2rn/cli` | 命令注册、参数解析、终端输出、交互 | Node |
| `@e2rn/core` | scan / classify / plan / emit / verify / report | Node |
| `@e2rn/types` | 跨包共享的数据结构（`ScanResult`、`Finding`、`ConversionPlan`…） | 编译期 |
| `@e2rn/plugin-kit` | `definePlugin`、贡献点类型、契约测试工具 | Node（构建期） |
| `@e2rn/runtime` | Bridge、WindowStore、Boot、子运行时、UI 槽注册 | 设备 |
| `@e2rn/electron` | `electron` 命名空间与各 feature 实现 | 设备 |
| `@e2rn/polyfills` | Node 内置模块、环境指纹、全局安装 | 设备 |
| `@e2rn/metro-preset` | Metro 配置工厂、解析规则、Babel 插件集 | Node（打包期） |
| `@e2rn/plugin-*` | 官方插件（dialog、notification、sqlite…） | 两侧 |
| `templates/rn-default` | RN 工程骨架（只放胶水） | 生成期 |

## 2. 依赖方向

```text
types ◄── plugin-kit ◄── core ◄── cli
  ▲                        │
  │                        └──► metro-preset
  │
  ├── runtime ◄── electron
  └── polyfills
```

硬规则：

- **core 不得 import 任何设备侧包**（runtime / electron / polyfills / react-native）。转换期与运行期必须能在不同机器上独立工作。
- **electron 可以依赖 runtime，反之不行**。runtime 不知道 Electron 的存在，只提供 Bridge、store、feature 注册表。
- **plugin-kit 只依赖 types**。它要能被插件作者单独安装，不能拖入 React Native。
- **cli 只做编排**：不实现扫描、不写模板逻辑。所有能力通过 core 暴露。
- **模板不得包含业务逻辑**。模板里出现 `if (config.xxx)` 分支，说明该逻辑应该进 plan/emit。

## 3. 目录结构

```text
e2rn/
├── packages/
│   ├── cli/
│   │   └── src/{bin,commands,ui}/
│   ├── core/
│   │   └── src/
│   │       ├── scan/          # 入口发现、角色传播、语法/语义扫描、HTML
│   │       ├── classify/      # 规则引擎、Tier、Verdict
│   │       ├── plan/          # 计划生成、冲突检测
│   │       ├── emit/          # 文件生成、补丁、备份
│   │       ├── verify/        # resolve / bundle / smoke
│   │       └── report/        # markdown / json / todos
│   ├── types/
│   ├── plugin-kit/
│   ├── runtime/
│   │   └── src/
│   │       ├── bridge/        # 消息编解码、窗口桥
│   │       ├── window/        # WindowManager、标题栏、槽位
│   │       ├── boot/          # 启动序列、环境安装
│   │       └── child/         # 子运行时（Android）
│   ├── electron/
│   │   └── src/features/      # app / window / ipc / dialog / shell / ...
│   ├── polyfills/
│   │   └── src/{node,env}/
│   ├── metro-preset/
│   └── plugins/
│       ├── dialog/
│       ├── notification/
│       └── sqlite/
├── templates/rn-default/
├── examples/                  # 供 check 用的最小 Electron 工程
├── docs/
└── scripts/
```

## 4. 测试策略

| 层级 | 工具 | 覆盖什么 | 何时跑 |
|---|---|---|---|
| 单元 | vitest | 规则判定、角色传播、路径映射、wire 编解码 | 每次提交 |
| fixture 矩阵 | vitest + `test/fixtures/*` | clean / blocked / multi-entry / TS / 非 ASCII 路径 / monorepo | 每次提交 |
| 报告快照 | vitest snapshot | `report.md` 结构稳定，规则 ID 不漂移 | 每次提交 |
| 契约 | `@e2rn/plugin-kit/testing` | 插件 schema、冲突、`resolves` 生效 | 插件 CI |
| 解析 | Metro resolver（编程调用） | `resolve-map.json` 覆盖完整 | 每次提交 |
| 打包 | `react-native bundle` | 语法降级、collector 兼容 |  nightly |
| 真机 | 手工 + 脚本 | 启动、IPC 往返、窗口、返回键 | 发版前 |

fixture 约定：

```text
packages/core/test/fixtures/<name>/
├── package.json          # 声明 main / electron 版本
├── main.js|ts
├── preload.js
├── index.html
├── renderer.js
└── expected.json         # 期望的 findings（id + severity + 数量）
```

新增规则必须同时新增或更新 fixture；没有 fixture 的规则不允许合并。

## 5. 类型与代码规范

- TypeScript `strict`，公共 API 不出现 `any`（内部可以用 `unknown` + 收窄）。
- ESM + `moduleResolution: "node16"`，相对 import 带 `.js` 后缀。
- 错误统一 `E2RNError`：`{ code, message, hint, ruleId? }`，终端输出用 `code` 分类。
- 路径处理一律 `path.join` / `path.resolve`，禁止硬编码分隔符；Windows 下大小写不敏感要显式处理。
- 不在库代码里 `console.log`：走 `ctx.logger`，便于 `--quiet` 与结构化输出。
- 生成的文件首行必须含 `@e2rn-generated` 标记，用于覆盖保护。

## 6. 版本与发布

| 包 | 版本策略 |
|---|---|
| `cli` / `core` | semver，changesets 管理 |
| `runtime` / `electron` / `polyfills` | 与 `cli` 同 minor 对齐（peer 约束 `^0.x`） |
| `plugin-kit` | 独立 semver；`apiVersion` 整数随破坏性变更 +1 |
| `metro-preset` | 跟随 RN 大版本，声明 `peerDependencies.react-native` |
| 插件 | 独立 semver；`engines.e2rn` 声明兼容区间 |

发布检查：

1. `pnpm typecheck && pnpm test`
2. `pnpm build`
3. `e2rn convert` 跑三个 example，确认 `verify.resolve` 通过
4. 更新 `CHANGELOG.md` 与文档中的兼容矩阵
5. 打 tag，changesets 发布

## 7. 文档权威性

文档之间冲突时，按此优先级：

1. `docs/04-plugins.md`（插件契约）
2. `docs/06-runtime-api.md`（API 行为）
3. `docs/02-pipeline.md`（流程与产物）
4. `docs/03-compatibility.md`（判定与矩阵）
5. `DESIGN.md`（决策背景，不描述细节）
6. `README.md`（概览）

规则：

- 改行为必须同时改文档与 fixture；只改代码的 PR 视为未完成。
- 文档里的支持标签（等价/近似/受限/不支持）是**承诺**，改动需要在 PR 描述里说明证据。
- 新增规则 ID 要更新 [03](03-compatibility.md) §7 的注册表。

## 8. 贡献流程

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck

# 开发 CLI（监听 core）
pnpm --filter @e2rn/core dev
pnpm --filter @e2rn/cli dev

# 用 example 验证
node packages/cli/dist/bin/e2rn.js check examples/simple-main-renderer
```

提交信息：

```text
feat(core): 支持 tsconfig paths 转 moduleMap
fix(runtime): 修复窗口二次 loadURL 不生效
docs(plugins): 补充 children 贡献点示例
```

PR 需要包含：改动说明、影响的规则 ID、测试或 fixture、文档更新。

## 9. 文档维护

| 文档 | 谁负责 | 更新时机 |
|---|---|---|
| README | 维护者 | 定位/能力变化 |
| DESIGN | 架构负责人 | 新增或推翻一项决策 |
| 01 架构 | 运行时负责人 | 启动序列、IPC 路径、Bridge 契约变化 |
| 02 流水线 | core 负责人 | 阶段、产物、验证变化 |
| 03 兼容性 | 规则维护者 | 新增 API/模块支持、证据更新 |
| 04/05 插件 | 插件系统负责人 | 贡献点、钩子、API 版本变化 |
| 06 API | 运行时负责人 | 成员行为变化 |
| 07 渲染 | 渲染负责人 | 窗口/注入/资源服务变化 |
| 08 限制 | 全员 | 发现新的不可移植能力 |
| 10 案例 | 全员 | 完成一次工程转换（可写真实项目，需脱敏业务数据） |

> 文档不是交付物的附属品，它和代码一样有 owner、有测试（fixture/快照）、有版本。
