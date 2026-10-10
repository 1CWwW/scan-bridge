# 代码桥 · Code Bridge

通过屏幕把代码传到手机：短代码使用普通文本二维码直接复制；多个文件或文件夹使用 CIMBAR 彩色动画传输。Linux 发送端是一个可双击打开的离线 HTML，无需安装运行环境。

An offline, single-file browser tool for transferring text or source files from a desktop screen to a phone. Plain QR codes carry text directly; the file mode uses the upstream CIMBAR optical transfer engine.

![直接文本二维码界面](docs/images/direct-text.png)

## 下载与运行

从 [Releases](https://github.com/1CWwW/code-bridge/releases) 下载 `code-bridge.html`，用 Chrome、Chromium 或 Firefox 打开。也可克隆仓库，直接打开 `dist/code-bridge.html`。

发送端运行时不请求网络；所有运行依赖都已嵌入。Python 和 Node.js 仅用于修改源码后的构建或测试。

## 两种传递方式

| 模式 | 适合 | 手机端 | 内容恢复 |
| --- | --- | --- | --- |
| 直接文本二维码 | 粘贴短代码、配置、报错信息 | 支持普通文本读取与复制的扫码工具 | 扫码复制原文，无需 ZIP |
| 文件传输 | 多个 Java 文件、整个文件夹、ZIP、diff | Safari 打开上游 [CIMBAR 接收页](https://cimbar.org/recv.html)，选择 B 模式 | 自动恢复 ZIP，保留目录和原始文件字节 |

**直接文本**：粘贴代码，点击“生成文本二维码”。默认每张 1200 个 UTF-8 字节，可选 600 或 2200。长文本会分成多张，按界面显示的顺序扫描、复制、拼接。二维码只含原文片段，不含链接或序号。iPhone 系统相机可能不展示普通文本，需要支持文本复制的扫码工具。

**文件传输**：切换模式，拖入文件或文件夹，点击“压缩并准备”，再点击“开始传输”。手机摄像头对准完整彩色码，接收完成后把 ZIP 保存到“文件”App 并解压。接收页首次加载需要手机联网和相机权限；电脑无需联网或与手机连接同一网络。文件夹拖入受浏览器支持影响，可改用“选择文件夹”。

默认过滤 `.git`、`target`、`build`、`node_modules` 等目录，可取消过滤。每次最多 5000 个文件，原文件合计 20 MiB、生成 ZIP 25 MiB。ZIP 附带逐文件 SHA-256 清单；可选生成 `__codebridge__/AI-context.md` 以汇集 UTF-8 源码和问题说明。

详细步骤、容量说明和兼容性见 [使用说明](docs/usage.zh-CN.md)。项目用于传递你有权导出的内容，不提供隐藏操作或规避审计功能。

## 验证范围与限制

自动化验证覆盖二维码独立解码、中文与表情、长文本分段、真实磁盘拖入、目录过滤、ZIP 原字节与校验清单、编辑失效、动画启停，以及发送端没有 HTTP/HTTPS 请求。

本地验证使用 Windows Chrome；GitHub 工作流使用 Ubuntu Chromium。**iPhone Safari、真实摄像头链路和具体 Linux 桌面尚需实机验证**，请先试一两个小文件。普通文本扫码工具可能改变复制格式；需要保留原文件换行字节时使用文件模式。彩色动画需要 WebAssembly 和 WebGL，速度取决于屏幕、相机和拍摄条件。发送端没有接收反馈通道，完成状态以手机为准。

## 开发与构建

需要 Python 3.10 或更新版本，仅使用标准库：

```sh
python3 source/build.py
```

输出 `dist/code-bridge.html` 和便于检查的 `dist/cimbar-engine.html`。构建校验 vendored 依赖的 SHA-256，不访问网络，输出可重复生成。

```text
source/app.html          中文界面、文本 QR、文件读取与打包
source/build.py          依赖校验、发送引擎补丁与单文件构建
source/vendor/           固定版本依赖、来源清单和原许可证
dist/                   可直接打开的构建结果
tests/                  合成数据的浏览器与独立解码测试
docs/                   使用说明与界面预览
```

## 测试

需要 Node.js 22+、Python 3.10+。首次安装测试依赖需要联网：

```sh
npm ci
npx playwright install chromium
python3 -m pip install -r tests/requirements.txt
python3 source/build.py
npm test
python3 tests/verify_plain_decode.py
python3 tests/verify_code_zip.py
```

Linux CI 使用 `npx playwright install --with-deps chromium`。可设置 `CHROME_PATH` 指向现有 Chrome/Chromium 可执行文件。测试产物写入被 Git 忽略的 `test-results/`，二维码和 ZIP 样例全部是合成内容。

## 许可证与上游

本项目自有界面、构建工具和测试采用 [MIT](LICENSE)。**CIMBAR 及其修改部分采用 MPL-2.0**；其他 JavaScript 库采用 MIT，发送引擎的底层依赖保留各自许可证。生成的单文件包含这些不同许可的组件，不把整个捆绑文件统一改授 MIT。发行文件内也保留完整授权声明。

第三方版本、来源、修改说明以及 CIMBAR 对应源码见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。感谢 [sz3/libcimbar](https://github.com/sz3/libcimbar)、[fflate](https://github.com/101arrowz/fflate)、[js-sha256](https://github.com/emn178/js-sha256) 和 [Project Nayuki](https://www.nayuki.io/page/qr-code-generator-library)。
