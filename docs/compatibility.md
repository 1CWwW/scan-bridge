# 平台与文件兼容性

产品面向 Windows、macOS、Linux 电脑及不同品牌手机，支持范围取决于浏览器能力。“提供接收入口”和“实机扫码验证通过”是两个不同层面的验证。

## 电脑端

| 环境 | 自动化验证 | 其他限制 |
| --- | --- | --- |
| Windows + Chromium | GitHub Actions 与本地 Chrome 检查 | 云桌面或管理策略可能限制文件读取或图形能力 |
| macOS + Chromium | GitHub Actions 检查 | 未验证所有 macOS 版本或 Safari 文件模式 |
| Ubuntu + Chromium | GitHub Actions 检查 | 未覆盖每种 Linux 桌面、发行版或显卡 |
| Edge、Firefox、Safari 等 | 面向标准浏览器设计，尚未完成完整回归 | 文件夹拖入、全屏与图形能力可能存在差异 |

CI 使用无界面 Chromium 和软件图形加速，检查本地 HTML、文件读取、打包、发送动画，不模拟真实相机拍摄屏幕。

## 手机端

文本二维码使用支持 UTF-8 文本读取与复制的工具。文件模式默认使用 [扫码桥自动接收端](https://1CWwW.github.io/scan-bridge/receiver/)；Android 另有上游 [CFC](https://github.com/sz3/cfc) 应用入口，正式支持范围以其说明为准。

iOS 提示使用 Safari；Android 提示浏览器或 CFC；HarmonyOS 及其他系统提示先确认浏览器相机可用。网页相机需要安全上下文和用户授权，见 [MDN 相机 API 说明](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。目前没有真实手机摄像头端到端测试记录，不声称认证所有品牌和系统。

## 文件内容

不按扩展名分类处理数据。测试使用有效合成 DOCX、XLSX、PPTX、PDF、PNG、TXT 及任意二进制文件，逐字节验证原文件直传与 ZIP 解包，再用独立 Python 读取器检查办公样例。

旧版 DOC / XLS / PPT、WPS、音视频等通过相同字节通道处理，但未为每种格式验证手机应用打开效果。传输文件与在手机上显示、编辑或播放是独立能力。

## 大文件验证与合并限制

测试完整读取并独立核对一个 2 GiB + 129 字节文件的 SHA-256，生成其首末分卷，另外测试 5 GiB 偏移算术（不是 5 GiB 实际传输）。35 MiB 文件完整分卷，浏览器与 Python 独立还原；验证缺卷、重复卷、混用卷和损坏卷拒绝，TAR 的 Unicode 路径及逐文件 / 整包校验值。

浏览器写盘生命周期使用模拟 writer 检查，不自动操作系统保存对话框。真实手机拍摄、2 GiB 的完整光学传输和所有卷的手机保存尚未实测。浏览器还原页仅在具备 File System Access 写盘接口时提供大文件流式合并；其他浏览器内存合并限 128 MiB，超过时拒绝并提示使用电脑或 Python。

## 新接收页的验证范围

自动接收页按能力检测 HTTPS / localhost、OPFS、Dedicated Worker 中的 `createSyncAccessHandle` 和 Web Locks。Safari 的后台同步写盘能力与桌面保存选择器不同，本实现不要求 iPhone 具备 `showSaveFilePicker`。相机入口使用视频画布读取，避免强制依赖 WebCodecs 的 VideoFrame 格式。

本地自动化实际接收 201 MiB + 123 字节文件并导出到磁盘，与独立 Node.js SHA-256 相符；覆盖乱序、重复、混入、损坏、撕裂日志及刷新恢复、单写入锁和离线缓存。17 MiB + 91 字节可压缩文件实际经过发送器生成的彩色画面、上游 WASM 提取/喷泉码/解压及本地 OPFS 恢复；这没有模拟手机拍摄的光学失真，也不是吞吐量测试。

CI 默认运行 201 MiB 接收测试；设置 `SCANBRIDGE_RECEIVE_GIB_TEST=1` 可运行 2 GiB + 129 字节的完整写盘接收与导出压力测试，使用普通浏览器持久目录并需要约 7 GiB 临时磁盘空间。默认无痕浏览器存储的实际限制可能小于报告配额；遇到写盘异常不提交该块。不要把浏览器配额估计当作可用容量保证。

没有任何真实手机数百 MB / 多 GB 全链路通过记录；HarmonyOS、旧版 Safari、应用内浏览器及无痕模式均需设备验证。不支持所需 API 时会明确拒绝启用自动接收。旧版独立 `merge-parts.html` 的 128 MiB 回退限制依旧存在。

Windows 本地普通 Chrome 存储的额外压力测试已完成：2 GiB + 129 字节实际接收、写盘、乱序/损坏恢复、完整导出和离线刷新后的全文件复核全部通过，导出摘要与独立 Node.js 一致。该结果是存储与接收会话测试，不等于手机光学传输了 2 GiB。

另新增完整 8 MiB 不可压缩块测试：随机数据封装，经实际编码器与 1080 × 1920 合成画布、WASM 解码器恢复，核对完整封装 SHA-256。CI 在 Ubuntu 运行 `npm run test:dense`；Windows 本地也通过。相机回调停滞、零时间戳、陈旧视频计数、暂停继续、切换采集方式及解码超时采用可控替身独立测试，尚无真实 iPhone 修复确认。

v1.5.3 以 v1.5.1 原版 Service Worker 复现缓存截获带参数刷新，使用真实 OPFS 8 MiB 数据块验证失败更新、重试、外部更新入口、版本握手、标签页锁与离线恢复。更新前后数据 SHA-256、提交日志、其他应用缓存及 localStorage 保持一致。Worker 构造被拒、私密存储返回 SecurityError、初始化无响应及超过 20 秒仍有进度的恢复有单独模拟测试；这不代表真实 iPhone 私密模式已支持大文件接收。
