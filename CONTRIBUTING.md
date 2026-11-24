# 贡献指南

先读两份文档再动手：

- [DESIGN.md](DESIGN.md)：为什么是这个方案（避免重复讨论已被否决的路线）。
- [docs/09-repository.md](docs/09-repository.md)：包边界与依赖方向（避免把逻辑放错层）。

## 1. 环境

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

要求 Node ≥ 18、pnpm 9+。Windows 下注意路径分隔符，统一用 `path.join`。

## 2. 改代码前先定位层

| 你想改 | 应该落在 |
|---|---|
| 新增一条风险规则 | `packages/core/src/classify/rules/` + fixture |
| 支持一个 Electron API | `packages/electron/src/features/`（或写成官方插件） |
| 支持一个 Node 内置模块 | `packages/polyfills/src/node/` |
| 改窗口/注入/资源服务 | `packages/runtime/` |
| 改转换流程或产物 | `packages/core/src/{plan,emit,verify}/` |
| 改打包解析 | `packages/metro-preset/` |
| 改 CLI 交互 | `packages/cli/src/commands/` |

**不要**在 core 里 import 设备侧包（react-native / runtime / electron）。转换期与运行期必须能独立运行。

## 3. 插件贡献

插件是首选扩展方式。写插件前读 [docs/04-plugins.md](docs/04-plugins.md) 与 [docs/05-plugin-guide.md](docs/05-plugin-guide.md)。

原则：

- **不要伪造能力**。不支持的成员抛错并在 `members.missing` 声明。
- **能力声明要带证据**。没有 fixture 的 `resolves` 会被降级，报告里会标"未验证"。
- **一个插件可以做多件事**。不要为了"归类"把 API、规则、UI 拆成四个包。
- **贡献点优先于钩子**。能用 `moduleMap` / `electron` / `ui` 声明的，不要写 `onEmit` 改文件。
- **不要改 `metro.config.js` / 原生工程**。用 `moduleMap` / `native` 贡献点。

官方插件放 `packages/plugins/<name>`，命名 `@e2rn/plugin-<name>`；社区插件建议 `e2rn-plugin-<name>`。

## 4. 测试要求

- 新增规则 → 必须有 fixture 与 `expected.json`，并更新报告快照。
- 修改 API 行为 → 必须更新 [docs/06-runtime-api.md](docs/06-runtime-api.md) 的对应行。
- 修改支持标签（等价/近似/受限/不支持）→ PR 描述里给出证据（fixture、日志、设备）。
- 新增规则 ID → 更新 [docs/03-compatibility.md](docs/03-compatibility.md) §7。

没有测试的规则不算完成；没有文档的行为变更不算完成。

## 5. 提交与分支

| 类型 | 用途 |
|---|---|
| `feat:` | 新功能 |
| `fix:` | 缺陷修复 |
| `refactor:` | 重构（不改行为） |
| `docs:` | 文档 |
| `test:` | 测试 |
| `chore:` | 构建/依赖 |
| `perf:` | 性能 |
| `BREAKING CHANGE:` | 破坏性变更（需同步 `apiVersion`） |

分支：`main` 稳定；`feat/<name>`、`fix/<name>`、`docs/<name>` 开发；PR 合并到 `main`。

## 6. 文档即契约

文档里的支持标签是承诺。发现文档与实现不一致时：

1. 先确认哪边是错的（跑 fixture，不要靠印象）。
2. 修错的一边。
3. 如果改了结论，在 PR 里说明"原结论为什么不再成立"。

不允许"代码先合并、文档后补"。文档更新属于同一次提交。
