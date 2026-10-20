"""Build the offline distribution using only Python's standard library.

Original build tooling: MIT. Changes applied to CIMBAR below: MPL-2.0.
"""
from pathlib import Path
import base64
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parent
version = json.loads((ROOT.parent / 'package.json').read_text(encoding='utf-8'))['version']
vendor = ROOT / 'vendor'
manifest = json.loads((vendor / 'manifest.json').read_text(encoding='utf-8'))
for filename, info in manifest.items():
    digest = hashlib.sha256((vendor / filename).read_bytes()).hexdigest()
    if digest != info['sha256']:
        raise SystemExit(f'Vendored dependency changed: {filename}. Review and update manifest.json.')

engine = (vendor / 'cimbar_js.html').read_text(encoding='utf-8')
engine = engine.replace('<link rel="manifest" href="pwa.json">', '')
engine = engine.replace("if ('serviceWorker' in navigator) {\n      navigator.serviceWorker.register('./sw.js');\n    }", '')
engine = engine.replace('Main.init(canvas);', "Main.init(canvas); window.parent.postMessage({type:'codebridge-ready'}, '*');")
# Cancel stale FileReader callbacks when stopping/restarting a transmission.
engine = engine.replace('function importFile(file) {', 'var _importGeneration = 0;\n  function importFile(file) {\n    const token = ++_importGeneration;')
engine = engine.replace('reader.onload = function (event) {', 'reader.onload = function (event) {\n      if (token !== _importGeneration) return;')
engine = engine.replace('importFile: function (file) {', 'cancelImport: function () { _importGeneration++; },\n\n    importFile: function (file) {')
engine = engine.replace('<title>Cimbar Encoder</title>', '<title>扫码桥发送引擎</title>')
engine = engine.replace('⌜ Tap to start! ⌟', '准备好文件后，点击“开始传输”')
# Filenames are literal text, including on systems that allow < and > in names.
engine = engine.replace('Report.setHTML("current-file", filename);',
                        'document.getElementById("current-file").textContent = filename;')
engine = engine.replace('⚠️⚡ PHOTOSENSITIVITY WARNING!', '彩色动画会快速闪动')
engine = engine.replace('Photosensitive epilepsy + flickering light = seizure!', '对闪光敏感的人请避免直视动画区域')
engine = engine.replace('Be safe! Have fun! ⚠️⚡', '手机接收完成后，可点击“停止”')
style = '<style>#nav-container{display:none!important}body{background:white;color:#56657a}#dragdrop{outline:3px solid #111;box-shadow:none}.drop-message{background:#f7faff;color:#56657a;justify-content:center;padding:25px}.drop-message p{font:15px system-ui,sans-serif}.drop-message p:first-of-type{font:18px system-ui,sans-serif}.msg-bottom{margin-top:24px!important}#canvas{visibility:hidden}</style>'
engine = engine.replace('</body>', style + '</body>')

# Retain notices in standalone assets, including the mixed-license source link.
notice_files = [ROOT.parent / 'LICENSE'] + [vendor / name for name in
    ['CIMBAR-LICENSE.txt', 'fflate-LICENSE.txt', 'sha256-LICENSE.txt', 'qrcodegen-LICENSE.txt']]
notice_files += sorted((path for path in (vendor / 'cimbar-notices').iterdir() if path.name != 'sources.json'),
                       key=lambda path: path.name)
notices = '\n\n'.join(path.read_text(encoding='utf-8') for path in notice_files)
notice = f'''<!--
Scan Bridge v{version}: original wrapper MIT; CIMBAR and modifications MPL-2.0.
Local source and patches: https://github.com/1CWwW/scan-bridge
Corresponding CIMBAR encoder source: https://github.com/sz3/libcimbar/tree/v0.6.8
Complete notices follow.
''' + notices.replace('-->', '-- >') + '\n-->\n'
engine = engine.replace('<head>', '<head>\n' + notice, 1)
template = (ROOT / 'app.html').read_text(encoding='utf-8')
libraries = '\n'.join('<script>\n' + (vendor / file).read_text(encoding='utf-8').replace('</script', '<\\/script') + '\n</script>' for file in ['fflate.js', 'sha256.js', 'qrcodegen.js'])
large = '<script>\n' + (ROOT / 'large-files.js').read_text(encoding='utf-8') + '\n</script>'
libraries += '\n' + large
html = template.replace('<!--BUNDLED_LIBRARIES-->', libraries).replace('__ENGINE_BASE64__', base64.b64encode(engine.encode()).decode())
html = html.replace('<head>', '<head>\n' + notice, 1)
output = ROOT.parent / 'dist'
output.mkdir(exist_ok=True)
for filename, content in [('scan-bridge.html', html), ('code-bridge.html', html), ('cimbar-engine.html', engine)]:
    target = output / filename
    target.write_text(content, encoding='utf-8', newline='\n')
    print(target.relative_to(ROOT.parent))
merge = (ROOT / 'merge-parts.html').read_text(encoding='utf-8')
hash_library = '<script>\n' + (vendor / 'sha256.js').read_text(encoding='utf-8') + '\n</script>'
merge = merge.replace('<!--MERGE_LIBRARIES-->', hash_library + '\n' + large).replace('<head>', '<head>\n' + notice, 1)
(output / 'merge-parts.html').write_text(merge, encoding='utf-8', newline='\n')
(output / 'merge-parts.py').write_text((ROOT / 'merge-parts.py').read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
receiver = output / 'receiver'
receiver.mkdir(exist_ok=True)
for source, target in [('receiver.html', 'index.html'), ('receiver.js', 'receiver.js'),
                       ('receiver-store.js', 'receiver-store.js'), ('receiver-decoder.js', 'decoder-worker.js'),
                       ('large-files.js', 'protocol.js')]:
    content = (ROOT / source).read_text(encoding='utf-8').replace('__VERSION__', version)
    if target.endswith('.html'):
        content = content.replace('<head>', '<head>\n' + notice, 1)
    (receiver / target).write_text(content, encoding='utf-8', newline='\n')
for source, target in [('sha256.js','sha256.js'),('receiver/cimbar_js.js','cimbar_js.js'),
                       ('receiver/cimbar_js.2026-08-21T2336.wasm','cimbar_js.2026-08-21T2336.wasm')]:
    shutil.copyfile(vendor / source, receiver / target)
(receiver / 'LICENSES.txt').write_text(notice, encoding='utf-8', newline='\n')
shell = hashlib.sha256()
for filename in sorted(['index.html', 'receiver.js', 'receiver-store.js', 'decoder-worker.js',
                        'protocol.js', 'sha256.js', 'cimbar_js.js', 'cimbar_js.2026-08-21T2336.wasm']):
    shell.update(filename.encode() + b'\0' + (receiver / filename).read_bytes())
build = shell.hexdigest()[:16]
sw = (ROOT / 'receiver-sw.js').read_text(encoding='utf-8').replace('__VERSION__', version).replace('__BUILD__', build)
(receiver / 'sw.js').write_text(sw, encoding='utf-8', newline='\n')
updater = (ROOT / 'update-receiver.html').read_text(encoding='utf-8').replace('__VERSION__', version)
(output / 'update-receiver.html').write_text(updater.replace('<head>', '<head>\n' + notice, 1), encoding='utf-8', newline='\n')
(output / 'receiver-version.json').write_text(json.dumps({'version': version, 'build': build}, sort_keys=True) + '\n', encoding='utf-8', newline='\n')
# Keep the requested historical scanner independent of the default receiver.
# Only its page notice and cache namespace differ from the tagged release.
pinned = json.loads((ROOT / 'pinned/1.5.2/manifest.json').read_text(encoding='utf-8'))
legacy = output / 'receiver-v1.5.2'
legacy.mkdir(exist_ok=True)
for filename, info in pinned['files'].items():
    source = ROOT / info['source']
    data = source.read_bytes() if filename.endswith('.wasm') else source.read_text(encoding='utf-8').encode('utf-8')
    if hashlib.sha256(data).hexdigest() != info['sha256']:
        raise SystemExit(f'Pinned 1.5.2 asset changed: {filename}. Review the historical version before updating.')
    (legacy / filename).write_bytes(data)
print('dist/receiver/ (HTTPS or localhost required for camera and persistent storage)')
print('dist/receiver-v1.5.2/ (fixed v1.5.2 scanner; separate program cache, shared receive storage)')
