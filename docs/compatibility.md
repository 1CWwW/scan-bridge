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

文本二维码使用支持 UTF-8 文本读取与复制的工具。文件模式使用上游 [网页接收端](https://cimbar.org/recv.html)；Android 另有上游 [CFC](https://github.com/sz3/cfc) 应用入口，正式支持范围以其说明为准。

iOS 提示使用 Safari；Android 提示浏览器或 CFC；HarmonyOS 及其他系统提示先确认浏览器相机可用。网页相机需要安全上下文和用户授权，见 [MDN 相机 API 说明](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。目前没有真实手机摄像头端到端测试记录，不声称认证所有品牌和系统。

## 文件内容

不按扩展名分类处理数据。测试使用有效合成 DOCX、XLSX、PPTX、PDF、PNG、TXT 及任意二进制文件，逐字节验证原文件直传与 ZIP 解包，再用独立 Python 读取器检查办公样例。

旧版 DOC / XLS / PPT、WPS、音视频等通过相同字节通道处理，但未为每种格式验证手机应用打开效果。传输文件与在手机上显示、编辑或播放是独立能力。

## 大文件验证与合并限制

测试完整读取并独立核对一个 2 GiB + 129 字节文件的 SHA-256，生成其首末分卷，另外测试 5 GiB 偏移算术（不是 5 GiB 实际传输）。35 MiB 文件完整分卷，浏览器与 Python 独立还原；验证缺卷、重复卷、混用卷和损坏卷拒绝，TAR 的 Unicode 路径及逐文件 / 整包校验值。

浏览器写盘生命周期使用模拟 writer 检查，不自动操作系统保存对话框。真实手机拍摄、2 GiB 的完整光学传输和所有卷的手机保存尚未实测。浏览器还原页仅在具备 File System Access 写盘接口时提供大文件流式合并；其他浏览器内存合并限 128 MiB，超过时拒绝并提示使用电脑或 Python。
