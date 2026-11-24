# 08 · 限制与替代方案

> 这一章只写"做不到"和"怎么办"。不写"未来会支持"。
> 判断标准：如果移动端操作系统层面没有这个能力，就归为不可移植，不给假实现。

## 1. 三条原则

1. **不伪造**。宁可抛错，也不返回一个"看起来能用"的假对象——后者会把问题推迟到最难排查的运行时。
2. **可发现**。每个限制都对应一条规则 ID，`e2rn check` 必须报出来。
3. **给替代**。只写"不支持"是懒惰；必须给出移动端的对应做法。

## 2. 永久不可移植

| 能力 | 为什么 | 替代方案 | 规则 ID |
|---|---|---|---|
| `globalShortcut` | 移动端没有"全局键盘捕获"（系统级快捷键属于 OS/输入法） | 应用内快捷键（外接键盘时）；或删除该功能 | `electron-api.globalShortcut` |
| `Tray` | iOS 无托盘；Android 无等价交互 | Android 常驻通知；iOS 应用内入口 / Widget | `electron-api.Tray` |
| 系统级 `Menu` | 无应用菜单栏 | 标题栏/侧边栏 UI 插件；ActionSheet | `electron-api.Menu` |
| `desktopCapturer` / `getDisplayMedia` | 无桌面可采集，WebView 也不提供屏幕源 | 应用内录屏（`react-native-view-shot` / 原生录屏）；或改为"用户手动导入素材" | `renderer.get-display-media` |
| `autoUpdater` | 桌面更新链路与商店分发模型不同 | App Store / Google Play / EAS Update / CodePush | `electron-api.autoUpdater` |
| `child_process.spawn/exec/execFile` | 沙盒禁止执行外部二进制 | 纯 JS 重写；或改为服务端能力 | `builtin.child_process.spawn` |
| `cluster` | 无多进程主从模型 | 单进程 + 异步并发；或 Android 子运行时 | `builtin.cluster` |
| `vm` | Hermes 不提供运行时求值/独立上下文 | 构建期生成代码；或用纯 JS 解释器（如 `quickjs-emscripten`，体积大） | `builtin.vm` |
| `dgram` / 裸 UDP | 无 UDP socket API | 改 WebSocket / HTTP | `builtin.dgram` |
| `tls` 服务端 | 无监听 socket | 客户端 TLS 由 `fetch` 承担 | `builtin.tls` |
| `dns` 解析 | 无 DNS API | 用 `fetch` 走域名；需要解析时用 DoH over HTTPS | `builtin.dns` |
| 多显示器 | 单屏 | 折叠为单屏；`screen.getAllDisplays()` 返回一个 | `electron-api.screen.multi-display` |
| `BrowserView` / `WebContentsView` | 不能在一个 WebView 里嵌第二个浏览器实例 | 拆成独立窗口；或 iframe（受同源限制） | `electron-api.BrowserView` |
| `MessageChannelMain` / `MessagePortMain` | 跨进程端口无法跨 WebView 边界 | 用 IPC channel 模拟消息流 | `electron-api.MessageChannelMain` |
| 同步 `fs` | RN 文件 API 异步；同步实现会阻塞 UI 线程 | 改 `await fs.promises.*`；或写原生同步模块（不推荐） | `builtin.fs.sync` |
| `http.createServer` / `https.createServer` | 无法监听端口（纯 JS） | 改 IPC；或用原生 HTTP 服务插件（Android/iOS 均可，但要处理前台服务） | `builtin.http.server` |

## 3. 平台差异：Android 可，iOS 不可

| 能力 | Android | iOS | 说明 |
|---|---|---|---|
| 子进程（`fork`） | 可（真实 OS 进程 + 独立 Hermes） | **不可** | App Store 沙盒禁止 `fork/exec`；需在 iOS 上改单进程架构 |
| 后台常驻 | 前台服务（需通知） | 极受限（BGTask、有限时长） | 不要假设长连接/定时任务可靠 |
| 应用内 HTTP 服务 | 可（前台服务 + 通知） | 可（仅前台/有限后台） | iOS 退到后台会挂起 |
| 安装外部 APK/IPA | Android 可（需权限） | 不可 | 自更新在 iOS 上必须走商店 |
| 读取外部存储 | Scoped Storage + 权限 | 仅文件选择器 | 统一走系统选择器最稳 |
| 文件监听 | `FileObserver` 原生模块 | `NSFilePresenter`（不可靠） | 建议轮询或事件驱动 |
| 通知渠道 | 需 `POST_NOTIFICATIONS` + channel | 需权限申请 | 首次调用触发授权 |

## 4. 需要原生模块（可做，但不是纯 JS）

| 能力 | 推荐方案 | 代价 |
|---|---|---|
| 文件选择 | `@react-native-documents/picker` | 返回 URI，需复制进沙盒 |
| 图片选择 | `react-native-image-picker` | 权限 + 大图内存 |
| 本地通知 | `@notifee/react-native` | 渠道/权限/点击路由 |
| 安全存储 | `react-native-keychain` | iOS Keychain / Android Keystore |
| SQLite | `op-sqlite` / `react-native-sqlite-storage` | 迁移脚本、WAL、加密 |
| 文件系统（完整） | `react-native-fs` / `expo-file-system` | 无同步 API、无 watch |
| 加密 | `react-native-quick-crypto` | 包体增大；部分算法缺失 |
| 打印 / PDF | 原生打印、`react-native-html-to-pdf` | 排版差异 |
| 生物识别 | `react-native-biometrics` | 权限与降级策略 |
| 后台任务 | Android WorkManager / iOS BGTask | 调度不可控，需容错 |

## 5. 语义差异（不是"不能用"，是"用法变了"）

| 能力 | 桌面语义 | 移动端语义 | 影响 |
|---|---|---|---|
| 应用生命周期 | 进程常驻，窗口开关不影响进程 | 前后台切换，可能被系统回收 | 长连接、定时器、文件监听要能重建 |
| 退出 | `app.quit()` 真正退出 | iOS 不允许程序化退出 | 保存状态要在 `AppState: background` 时做 |
| 窗口 | 多窗口、可拖拽、可最小化 | 默认单全屏 | 多窗口 UI 需重新设计（`stack` 模式） |
| 文件路径 | 绝对路径稳定 | 沙盒路径 + URI 授权 | 保存路径不可硬编码 |
| 剪贴板 | 同步、多格式 | 异步、以文本为主 | 读写要 await；图片需原生 |
| 通知 | 系统通知中心 | 权限 + 渠道 + 前台展示策略 | 首次使用要引导授权 |
| 网络 | 可监听端口、可自定义 CA | 只能作为客户端 | 本地服务、代理、抓包类功能需重做 |
| 更新 | 应用内下载安装 | 商店审核 / OTA | 更新节奏受平台约束 |

## 6. 高风险应用类型

| 类型 | 典型依赖 | 结论 |
|---|---|---|
| IDE / 编辑器 | 扩展宿主（子进程）、PTY、原生搜索、文件监听 | Android 可做骨架（子运行时）；iOS 基本不可行 |
| 代理 / 抓包工具 | 本地 TCP 服务、MITM 证书、系统代理 | 纯 JS 不可行；需原生 VPN/代理能力，工作量大 |
| 下载器 | 多线程下载、外部工具（ffmpeg/aria2） | 改为原生下载库；不能调外部二进制 |
| 系统工具（托盘、快捷键） | `Tray`、`globalShortcut`、开机自启 | 交互模型需重做 |
| 企业内网工具 | 自定义 CA、Kerberos、注册表 | 多数不可移植，需服务端配合 |
| 纯数据/表单类应用 | IPC、文件读写、通知 | T1–T2，适合迁移 |

## 7. 迁移决策树

```text
1. 主进程是否 spawn/exec 外部程序？
   ├─ 是 → 能否改为纯 JS 或服务端？
   │        ├─ 能 → 继续
   │        └─ 不能 → T4，放弃或只迁移 UI
   └─ 否 → 2

2. 是否依赖原生 Addon（.node）？
   ├─ 是 → 有没有 RN 等价库？
   │        ├─ 有 → T2，替换
   │        └─ 无 → T3/T4，评估重写成本
   └─ 否 → 3

3. 是否用同步 fs 读写配置/数据？
   ├─ 是 → 能否改异步？
   │        ├─ 能 → T2
   │        └─ 不能 → T3（需原生同步模块）
   └─ 否 → 4

4. 渲染层是否依赖 Node（nodeIntegration / require）？
   ├─ 是 → 能否改 preload 暴露？
   │        ├─ 能 → T2
   │        └─ 不能 → T3，需重构渲染层
   └─ 否 → 5

5. 是否需要多进程 / 本地 HTTP 服务 / 屏幕采集 / 托盘 / 全局快捷键？
   ├─ 是 → 逐项评估替代；核心卖点依赖它 → T4
   └─ 否 → T1
```

## 8. 替代方案速查

| 原来做什么 | 移动端怎么做 |
|---|---|
| 读写配置文件 | `app.getPath('userData')` + 异步 fs；小配置用 MMKV/AsyncStorage |
| 打开文件 | `dialog.showOpenDialog` → 复制进沙盒 |
| 保存文件 | 写沙盒 → 分享面板 |
| 打开网页 | `shell.openExternal` |
| 系统通知 | 本地通知库 + 权限引导 |
| 托盘常驻 | Android 前台服务通知 |
| 右键菜单 | 长按菜单 / ActionSheet |
| 快捷键 | 应用内快捷键（外接键盘） |
| 自动更新 | 商店 / OTA |
| 本地 HTTP 服务 | IPC；或原生 HTTP 服务插件 |
| 代理 / 抓包 | 原生 VPN 服务（Android `VpnService` / iOS Network Extension），工作量大 |
| 多窗口 | 单全屏 + 页面路由；平板可用 `stack` |
| 后台任务 | WorkManager / BGTask，接受不精确调度 |
| 加密存储 | Keychain / Keystore |
| 大文件处理 | 流式 + 分块；避免一次性读入内存 |

## 9. 怎么向业务方解释

不要说"技术限制"，说清三件事：

1. **这个功能在手机上不存在对应的系统能力**（举例：手机没有"托盘"，只有通知）。
2. **替代方案是什么，体验差在哪**（举例：多窗口改为页面切换，用户少了一次并行操作）。
3. **工作量落在哪**（改造点数量、是否需要原生开发、是否影响上架）。

`e2rn check` 的报告可以直接作为这份说明的附件：每条都有位置、原因、建议。
