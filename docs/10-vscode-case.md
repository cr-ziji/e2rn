# 10 · 案例：VS Code 1.141 转换复盘

> 这是目前做过的最极端的一次转换：把一个万级文件、几十个 Electron 入口、20+ 原生 Addon 的桌面 IDE 主进程搬进 RN。
> 结论先放这里：**主进程无法完整运行**，但运行时骨架、解析映射、IPC、子进程方案都被验证了。

## 1. 工程形态

| 项 | 值 |
|---|---|
| 源码规模 | 约 11,800 个文件，其中约 10,000 个 `.ts` |
| Electron 直接引用 | 53 个文件 `import ... from 'electron'` |
| 架构 | 主进程 + 渲染层（DOM workbench）+ 扩展宿主 + PTY 宿主 + 共享进程 + 文件监听 |
| 进程通信 | `child_process.fork` + `net` 命名管道 |
| 原生依赖 | `node-pty`、`@vscode/sqlite3`、`native-keymap`、`@parcel/watcher`、`@vscode/spdlog` 等 20+ |

## 2. 结论

主进程无法完整在移动端运行。不是"某些 API 没实现"，而是架构前提冲突：

- 扩展、终端、共享进程、搜索（ripgrep）、Git 全部依赖子进程或外部二进制；
- 原生 Addon 需要为移动端重新编译，多数没有 RN 等价物；
- 单实例锁依赖 `net` 命名管道；
- workbench 是 Chromium DOM 应用，且大量依赖自定义 scheme 与 Node 侧资源路径。

可运行的是**运行时骨架**：窗口容器、IPC 总线、shim、Polyfill，以及任何不触碰上述阻断项的纯 JS 子集。

## 3. 踩到的坑（按发现顺序）

| # | 现象 | 根因 | 处理 |
|---|---|---|---|
| 1 | 打包报 `import()` 参数必须是字符串 | 代码里有 `import(expr)`，Metro collector 直接拒绝 | Babel 插件改写为 rejected Promise，让构建通过 |
| 2 | `import.meta` 解析失败 | Hermes 不支持 `MetaProperty` | Babel 降级为全局变量 |
| 3 | 构造器参数装饰器丢失 | RN preset 的 `transform-typescript` 会擦掉参数装饰器 | 自定义 Babel 插件在 preset 之前重写为函数调用 |
| 4 | 图标注册报 "unknown codicon" | Metro 默认 `inlineRequires: true` 改变了 ESM 求值顺序 | 关闭 `inlineRequires` |
| 5 | `Super expression must either be null or a function` | `vscode-jsonrpc` 被 `browser` 字段解析到浏览器构建，缺 Node 导出 | `forceEntry` 指向 `lib/node/main.js` |
| 6 | `Buffer.isBuffer` 判断异常，字符串变逗号数字 | RN 的 Buffer polyfill `subarray` 返回普通 `Uint8Array` | 补 `subarray` 返回真 Buffer；wire 反序列化还原 Buffer |
| 7 | 二进制 IPC 被解成 `{type:'Buffer',data:[...]}` | `JSON.stringify` 先调 `toJSON` 再调 replacer | replacer 识别该形状并转 base64 |
| 8 | 菜单点不开 / 下拉被遮住 | 部分 Android WebView 的 `document.hasFocus()` 恒 false，触发 `opacity < 1` 层叠上下文 | 注入脚本覆盖 `hasFocus` |
| 9 | 文件图标变方框 | `@font-face` 用 `vscode-file://`，WebView 无法加载 | 遍历 CSSOM 改写 URL 到资源服务 |
| 10 | 内置扩展扫描失败 | 代码里的 `/vscode/extensions` 在设备上不存在 | `fs` 增加 `assetRoot` 前缀映射；原生侧解包资源 |
| 11 | 启动后弹 "argv.json contains errors" | 桌面端由同步 fs 种子生成，移动端没有 | 启动前异步写入默认 `argv.json` |
| 12 | 全屏下菜单栏消失 | 桌面逻辑在全屏时隐藏菜单 | 种入 `window.menuBarVisibility: visible` |
| 13 | `process.on('uncaughtException')` 不生效 | npm `process` 的浏览器 shim 把事件方法实现为空 | 用真实 `EventEmitter` 重新绑定 |
| 14 | 某库在模块求值期抛 `userAgent.startsWith` | RN 的 `navigator` 只有 `product` | 补 `navigator.userAgent = 'Node.js/x'` |
| 15 | `process.argv` 为空导致参数被吃 | 参数解析默认丢弃 argv[0] | 启动前补一个非选项元素 |
| 16 | 每个子进程都下载整包 | 所有子进程共用主 bundle | 每个子进程独立 entry + 独立 bundle 名 |
| 17 | 窗口第二次 `loadURL` 不生效 | WebView `source` 未变不重新导航 | `reloadNonce` 作为 key 强制重挂载 |
| 18 | `executeJavaScript` 返回值永远是 undefined | Android `injectJavaScript` 不返回结果 | 文档标注限制；需要值走关联 id 回传 |

## 4. 哪些设计被验证是对的

- **In-Process**：主进程图能在 Hermes 里加载并跑到 `app.ready`，IPC 往返正常。若用 `nodejs-mobile`，这一层要额外背一个 Node 二进制与跨线程序列化。
- **解析层映射**：`electron` → shim、`fs` → polyfill，全部在 Metro 层完成，原始 `src/vs` 一个字节没改。这是"非侵入"唯一可行的实现方式。
- **子运行时**：把 `fork` 映射为真实 Android 进程后，扩展宿主 / PTY 宿主的启动路径能走通，验证了"多进程应用不是绝对无解"。
- **显式不支持**：`spawn`/`exec` 抛错而不是假装成功，让排查时间从"几天"降到"几分钟"。
- **报告驱动**：先出报告再动手，避免在 1 万文件里盲目试错。

## 5. 哪些早期判断被推翻

| 早期判断 | 实测结果 | 现在的写法 |
|---|---|---|
| "同上下文所以 `sendSync` 可以同步" | 渲染层在 WebView 自己的引擎，跨边界无同步通道 | 三策略 + 快照（[06](06-runtime-api.md) §5.3） |
| "`crypto.subtle` 在 Hermes 可用" | 不保证存在，需显式 polyfill | 矩阵标"近似"，要求装 quick-crypto |
| "`child_process` 一律不支持" | Android 可实现真实子进程 | 分级：fork 可（Android），spawn/exec 不可 |
| "`preload` 原样保留" | WebView 无 `require`，preload 必须打包 | 打成 IIFE 注入（[07](07-renderer.md) §3.2） |
| "按需生成 shim" | 无法测试、无法修 bug | 版本化运行时包 + 生成装配代码（DESIGN D4） |
| "复制源码再 AST 改写" | 破坏相对路径、双事实源 | `watchFolders` + 解析映射（DESIGN D3） |

## 6. 从这次转换提炼的规则

| 规则 | 落在哪 |
|---|---|
| 入口必须动态 `require`，不能顶层 `import` | [01](01-architecture.md) §3.2 |
| `inlineRequires` 默认关闭 | [02](02-pipeline.md) §6.2 |
| 非字面量 `import()` 是 build-breaking，扫描阶段就要报 | [02](02-pipeline.md) §2.3 |
| `browser`/`exports` 字段会导致解析错位，需 `forceEntry` | [02](02-pipeline.md) §6.3 |
| 二进制 IPC 必须显式编码，且还原为真 Buffer | [01](01-architecture.md) §7 |
| `document.hasFocus` 在部分 Android WebView 恒 false | [07](07-renderer.md) §7 |
| 自定义 scheme 必须改写（含 CSSOM） | [07](07-renderer.md) §6 |
| 逻辑路径 `/xxx` 需要 `assetRoot` 映射 | [03](03-compatibility.md) §4 |
| `process` 必须是 EventEmitter | [03](03-compatibility.md) §5.2 |
| `navigator.userAgent` 必须补 | [03](03-compatibility.md) §5.1 |
| 子进程必须独立 bundle | [01](01-architecture.md) §4.3 |
| 原生加速（如 crypto）必须可选，默认纯 JS | [02](02-pipeline.md) §5.3 |

## 7. 对文档结构的直接影响

1. 单独一章讲**环境指纹**（[03](03-compatibility.md) §5）——一半以上的崩溃来自这里。
2. 单独一章讲**渲染层**（[07](07-renderer.md)）——WebView 的坑与 Electron API 无关，混在一起会写不清。
3. 流水线增加 **plan** 阶段（[02](02-pipeline.md) §4）——大工程必须先审计划再写文件。
4. 插件从"按类型分类"改为"贡献点"（[04](04-plugins.md)）——一个 dialog 插件同时需要 API、UI、原生依赖、分析规则，按类型分类会把它拆碎。
5. 报告增加**能力等级**与**证据等级**（[03](03-compatibility.md) §2）——二元结论无法表达"能跑但只覆盖 60%"。
6. 原生加速与源码复制改为**配置可选**（[02](02-pipeline.md) §5.3）——默认纯 JS、不复制源码，避免把"转换"变成"接管工程"。

## 8. 新工程的复盘清单

转换一个新工程时，按这个顺序记录，复盘才有价值：

1. `e2rn check` 的原始输出（Tier、error 数、前 10 条 finding）。
2. 入口与角色分布（是否有 `unreachable` 文件）。
3. 第一次 `verify.resolve` 失败的说明符清单。
4. 第一次 `bundle` 失败的报错（通常是语法或 collector）。
5. 第一次真机启动的日志（卡在哪个 boot 阶段）。
6. 修复每一处所花的改动类型（配置 / 插件 / 用户代码 / 原生）。

出现两次以上的问题，就应该变成一条内置规则或一个官方插件。
