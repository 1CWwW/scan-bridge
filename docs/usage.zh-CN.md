# 代码桥 v1.2：Linux → iPhone 离线代码传递

这个版本用于 Linux 桌面上的 Chrome / Chromium / Firefox，提供两种模式：**直接文本二维码**用于扫码提取、复制代码；**CIMBAR 彩色动画码**用于传输多个文件并自动还原 ZIP。

## 直接扫码提取代码（默认模式）

1. 双击 `code-bridge.html`，用浏览器打开。
2. 默认选择“直接文本二维码 · 扫码复制”。将代码粘贴到输入框，点击“生成文本二维码”。
3. 手机使用支持普通文本读取和复制的扫码工具扫描右侧黑白二维码，即可直接读取代码。没有 ZIP、解压步骤或额外包装文本。
4. 超过单张容量时会自动分段。按顺序扫描、复制、拼接各段，不额外插入空格或换行。

默认每张最多 **1200 个 UTF-8 字节**，可选择 600 或 2200 字节。中文通常占 3 字节，常见表情占 4 字节。单张二维码容量有限，几十 KB 的代码无法装进一张普通文本二维码。二维码仅包含该张的原文片段，不含序号；张数与顺序显示在电脑界面。

此模式无需联网，也无需 WebGL。使用 UTF-8 ECI 标记，保留输入框里的代码、缩进、空格与换行。文本框会使用浏览器的文本换行格式；若要求保留文件原始 CRLF/LF 字节，使用文件传输模式。分段不拆开 Unicode 代理对或 CRLF。修改代码后会立即清除旧二维码。

若 iPhone 相机没有显示纯文本代码内容，请换用支持普通文本读取、复制的扫码工具。扫码工具可能会改变展示格式或裁剪空白；程序已用独立解码器验证二维码本身的原文内容。此模式不会调用 CIMBAR 配套接收页，配套页只用于彩色码文件传输。

支持“保存二维码”导出当前 PNG；它是可选功能，直接扫码无需生成文件。大量代码需要自动恢复时，可切换下面的文件传输模式。

## 文件传输：拖入 Java 文件或文件夹

1. 将 `code-bridge.html` 放到 Linux 电脑，双击，用浏览器打开，选择“文件传输 · 彩色动画”。发送端不需要联网、不需要安装 Python/Node，也不需要管理员权限。文件模式需要 JavaScript、WebAssembly 和 WebGL 支持。
2. 拖入多个 Java、XML、配置文件，或整个文件夹。也可点击“选择文件”“选择文件夹”。
3. 点击“压缩并准备”。默认忽略 `.git`、`target`、`build`、`out`、`node_modules`、`.gradle`、`.idea` 等目录；取消勾选可包含这些文件。
4. iPhone 用相机扫描页面上的小二维码，**在 Safari 打开 https://cimbar.org/recv.html**，允许使用后置相机。也可手动输入这个地址。小二维码只是接收工具的网址。
5. 接收页使用 **B 模式**。电脑点击“开始传输”，iPhone 对准彩色动画码。保持整个码、包括四角标记，位于相机画面内，等待接收端完成。
6. 接收完成后将 ZIP 保存到 iPhone 的“文件”App，点击 ZIP 解压。电脑点击“停止”。
7. ZIP 内保留原文件、目录结构和逐文件 SHA-256 清单。默认还包含 `__codebridge__/AI-context.md`，可以将它上传给 AI 一次处理多份源码。原文件是分析与还原的依据；上下文文件会统一展示换行，原文件字节不变。

首次打开 iPhone 接收页需要手机联网；Linux 电脑始终可以离线。网页接收需要安全上下文和相机权限，不建议把 HTML 当作 iPhone 附件打开代替 Safari 接收页。手机无需连接内网、同一 Wi-Fi、蓝牙或 USB。

### v1.1 拖入文件兼容修复

修复了本地页面拖入实际磁盘文件时出现的 `A URI supplied to the API was malformed...` 报错。该问题已用 Chromium 的真实磁盘拖拽数据复现：旧 `FileSystemFileEntry.file()` 失败，而直接 File 读取成功。

新版普通文件直接读取 File，文件夹优先使用 File System Access 的目录句柄。浏览器不支持或限制目录读取时，提示改用“选择文件夹”，其目录结构会保留；也可把目录打成 ZIP 再拖入。无需修改浏览器安全设置或开启特殊启动参数。

v1.1 已通过 Chromium DevTools 注入真实磁盘拖拽数据验证普通文件、多文件、文件夹、中文/表情文件名、空文件、构建目录过滤及文件夹选择入口，同时测试了旧接口抛出 EncodingError 时的恢复提示。文件读取方式参考 [直接 File 读取](https://developer.mozilla.org/en-US/docs/Web/API/DataTransferItem/getAsFile) 与 [File System Access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access#dragdrop)；这些测试在本机 Chrome 中进行，Linux 兼容性仍需用户设备确认。

## 容量、速度和使用习惯

- 当前包装界面每次最多选择 **5000 个文件**，原文件合计最多 **20 MB**，生成 ZIP 最多 **25 MB**。这些是本工具自己的上限；适合按模块传代码。
- 单张普通二维码的字符容量有限；本方案把文件转换为持续的彩色动画。接收端收集足够数据后自动恢复，不需要手动复制各段文本。
- 实际速度受屏幕分辨率、颜色、相机、浏览器和距离影响，未在你的硬件上测量，不承诺固定 MB/s。
- 默认 10 FPS；识别慢时试 5 FPS、全屏、增大屏幕亮度，并调整拍摄距离。整个彩色码及四角标记都应进入画面。
- 发送端没有手机反馈通道，不能显示“手机接收完成”。请看手机进度，完成后点击停止。
- 附带 AI-context.md 会增加 ZIP 体积；只需要原文件时可以取消勾选。非 UTF-8 或二进制文件不转为上下文文字，仍按原字节保留在 ZIP 内。
- 建议只传与问题有关的类、接口、测试和必要配置；已有 Git patch/diff 文件也可直接拖入，避免每次传整个项目。

## 当前验证范围

v1.2 已用独立 ZXing 解码器对 6 张普通文本二维码逐字节核对，覆盖 Java 代码、中文、表情、特殊符号、空白、长文本分段和 2200 字节边界；无需解压即可还原原文。浏览器测试覆盖分段导航、PNG 保存、编辑后清除旧码、空输入与两种模式切换。文件传输与真实磁盘拖入的回归测试也通过。

已在 Windows 上的 Chrome 中验证本地 `file://` 打开、发送引擎初始化、压缩打包、实际文件拖入事件、文件夹递归（含多批目录条目）、目录过滤、SHA-256 校验、动画帧变化、停止与重新发送，以及编辑后清除旧代码包。发送页面运行期间没有 HTTP/HTTPS 请求。

另用 Python 标准 ZIP 解码器独立解压并逐字节核对 Java、XML、空文件、中文、表情和混合换行，验证逐文件校验清单与上下文生成。一个包含 400 个简单 Java 方法的合成测试包，从约 29 KB 压缩为约 6 KB（包含上下文），这只是测试样例，不代表所有项目的压缩比例。

**尚未在你的 Linux 环境、iPhone Safari 和真实摄像头链路上做端到端验证。** CIMBAR 的网页接收端由上游项目维护，iPhone 兼容性与实际识别效果需先用一两个小文件试验。网页不适用时，可以换成常规连续二维码的 Safari 接收方案，或开发独立 iOS 接收应用；Linux 的文件选择与打包部分可复用。

## 源码、构建与许可证

- `source/app.html`：中文文件打包界面和发送控制。
- `source/build.py`：将界面、库和发送引擎合并为一个离线 HTML。使用 Python 3 运行，无需安装其他包；只在修改与重新构建时需要 Python。
- `source/vendor`：本地依赖、未修改的上游发送 HTML 和许可证。
- 构建方法：`python3 source/build.py`。
- 发送引擎为 [CIMBAR v0.6.8](https://github.com/sz3/libcimbar/releases/tag/v0.6.8)，MPL-2.0。对应完整引擎源码可在 [v0.6.8 源码](https://github.com/sz3/libcimbar/tree/v0.6.8) 获取。
- 本版修改了上游 HTML 的外观、接收界面初始化通知和取消旧 FileReader 读取的逻辑；修改过程完整包含在 `source/build.py` 中，CIMBAR 的编码二进制保持原样。
- ZIP 压缩为 [fflate v0.8.2](https://github.com/101arrowz/fflate/tree/v0.8.2)，MIT；SHA-256 为 [js-sha256 v0.11.1](https://github.com/emn178/js-sha256/tree/v0.11.1)，MIT；接收工具的网址二维码由 [Nayuki QR Code generator](https://www.nayuki.io/page/qr-code-generator-library) 生成，MIT，原授权声明保留在源码里。
- [CIMBAR 上游使用说明](https://github.com/sz3/libcimbar)；[浏览器相机安全上下文要求](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)。
