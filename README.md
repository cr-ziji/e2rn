# E2RN - Electron to React Native 转换工具

> 名称：`e2rn`（Electron To React Native）
> 定位：开源的 CLI 转换工具，目标是在**不修改用户 Electron 源代码**的前提下，自动生成一个可直接运行的 React Native 应用，使 Electron 项目能够平滑过渡到移动端。

## 1. 项目概述

### 1.1 核心思路

E2RN 采用 **In-Process（同进程同 JS 引擎）** 方案：将 Electron 主进程代码**直接打包进 React Native 的 JS Bundle**，在 Hermes/JSC 中执行，而不是运行在独立的 Node 进程中。

这个选择是吸取了早期 `e2c` 方案（采用 `nodejs-mobile`）实测出现的性能、包体积和复杂度问题后的权衡结果。

### 1.2 核心特性

- **非侵入式转换**：不修改用户的 `main`、`preload`、`renderer` 源代码
- **In-Process 主进程**：直接用 RN 内置 JS 引擎（Hermes/JSC）运行 Electron 主进程代码，减少通信开销，提升运行速度，减小包体积
- **窗口模拟**：基于 `react-native-webview` + 自研 `WindowManager` 模拟 Electron `BrowserWindow` 多窗口行为
- **Electron Shim**：自研 `@e2rn/electron` 运行时替身，按需实现常用 Electron API
- **Node 内置模块 Polyfill**：按需注入 Node builtins Polyfill，谨慎处理无法实现的模块
- **可控的兼容性**：静态分析驱动（Scan-Driven），对动态引入、原生模块不臆测，显式暴露风险清单
- **插件化生态**：API 映射、Polyfill、窗口 UI 等能力均可通过插件扩展

## 2. 快速开始（规划）

```bash
# 初始化配置
e2rn init

# 可行性检测（强烈推荐）
e2rn check

# 执行转换
e2rn convert

# 运行生成的 RN 项目
cd rn-app
npm install
npx react-native run-android  # 或 run-ios
```

## 3. 设计原则

- **In-Process 优先**：拒绝为理论通用性引入额外进程，优先选择轻量、高效的方案
- **显式优于隐式**：平台差异与无法兼容的能力必须在报告中明确标注，而不是静默降级
- **按需注入**：基于扫描结果，仅注入真正用到的 Shim 和 Polyfill
- **非侵入式**：用户代码是单一事实源，转换过程不破坏业务逻辑

## 4. 许可证

MIT
