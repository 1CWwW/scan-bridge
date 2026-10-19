# Third-party notices

Scan Bridge's original wrapper, build tooling and tests are MIT licensed. The bundled dependencies retain the following licenses; the complete distribution contains both MIT and MPL-2.0 components.

| Component | Version | License | Vendored file and notice | Upstream source |
| --- | --- | --- | --- | --- |
| CIMBAR | v0.6.8 | MPL-2.0 | `source/vendor/cimbar_js.html`, `CIMBAR-LICENSE.txt` | [Corresponding v0.6.8 source](https://github.com/sz3/libcimbar/tree/v0.6.8) |
| fflate | 0.8.2 | MIT | `source/vendor/fflate.js`, `fflate-LICENSE.txt` | [v0.8.2](https://github.com/101arrowz/fflate/tree/v0.8.2) |
| js-sha256 | 0.11.1 | MIT | `source/vendor/sha256.js`, `sha256-LICENSE.txt` | [v0.11.1](https://github.com/emn178/js-sha256/tree/v0.11.1) |
| Nayuki QR Code generator | Vendored compiled TypeScript snapshot | MIT | `source/vendor/qrcodegen.js` (embedded notice), `qrcodegen-LICENSE.txt` | [Project page](https://www.nayuki.io/page/qr-code-generator-library) |

Download URLs and SHA-256 digests for the exact local snapshots are recorded in `source/vendor/manifest.json`. Build inputs are checked against this manifest. We do not assign a release number to the unversioned Nayuki snapshot.

## CIMBAR source and modifications

The original sender comes from [the v0.6.8 release asset](https://github.com/sz3/libcimbar/releases/download/v0.6.8/cimbar_js.html). The corresponding C++/WebAssembly encoder source and upstream build instructions are available in [sz3/libcimbar at v0.6.8](https://github.com/sz3/libcimbar/tree/v0.6.8). The encoding binary is unchanged. The receiver also vendors the unmodified `cimbar_js.2026-08-21T2336.js` and `.wasm` members of the same release's `cimbar.wasm.tar.gz`, under `source/vendor/receiver/`. Their archive member names and exact SHA-256 digests are recorded in the manifest. Corresponding decoder source is in the same v0.6.8 source tree. Our `receiver-decoder.js` is an MIT adapter that calls the exported decoder API; it does not modify the binary or copy the upstream receiver UI.

`source/build.py` supplies all local changes to the sender's HTML/JavaScript: remove network-oriented PWA/service-worker setup, add a parent initialization notification, invalidate stale FileReader callbacks, and adjust the sender's labels and presentation, and render filenames as literal text. These modifications to CIMBAR remain under MPL-2.0. `dist/cimbar-engine.html` is the readable, patched HTML/JavaScript, including the unchanged embedded encoder. Rebuilding needs only Python and the vendored files.

Complete license texts are retained in `source/vendor`. The build also embeds Scan Bridge's license and all third-party license texts in the generated HTML outputs. When redistributing, preserve these notices and the MPL source availability information; the root MIT license does not relicense CIMBAR.

`source/vendor/cimbar-notices/` preserves the v0.6.8 source tree's native dependency notices (including libcorrect, wirehair and zstd), plus the OpenCV 4.12.0 and Emscripten 5.0.0 license texts referenced by upstream's [build workflow](https://github.com/sz3/libcimbar/blob/v0.6.8/.github/workflows/wasm.yml). These components have their own MIT, BSD, Apache or dual-license terms. Notices for optional upstream tools are retained as well; inclusion of a notice does not mean that tool is active in this application. Exact notice sources are recorded in that directory's `sources.json`.

## Development-only dependencies

Playwright, zxing-cpp and Pillow are used for tests and are not bundled in the application. Their versions are recorded in `package-lock.json` and `tests/requirements.txt`; their licenses and notices are distributed by their own packages.
