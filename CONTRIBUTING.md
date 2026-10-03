# 贡献指南（Contributing）

E2RN 采用 In-Process 运行时方案。贡献前请先阅读根目录 README.md 中的设计思路。

## 插件开发原则

- 对于移动端无法实现的能力（如 `child_process`、原生 Addon、全局快捷键等），**不要伪造实现**，应在 `checkViable` 中明确标注限制
- 优先复用成熟的 Polyfill（如 unenv/node-stdlib），避免重复造轮子
- 插件需提供最小可复现的 Electron 示例用于验证
- 遵循 TypeScript 类型约束，使用 `@e2rn/types` 定义的接口
- 插件包名推荐使用 `e2rn-plugin-<name>` 格式

## 开发流程

1. `pnpm install`（安装依赖，待环境就绪后执行）
2. `pnpm dev`（并行开发模式）
3. `pnpm build`（构建所有包）
4. `pnpm test`（运行测试）
5. `pnpm typecheck`（类型检查）

## 代码规范

- TypeScript 严格模式
- 不新增无用注释
- 最小改动原则
- Windows 路径兼容性需注意（使用 `path.join`/`path.resolve`，避免硬编码正斜杠）
