"""Build the offline distribution using only Python's standard library.

Original build tooling: MIT. Changes applied to CIMBAR below: MPL-2.0.
"""
from pathlib import Path
import base64
import hashlib
import json

ROOT = Path(__file__).resolve().parent
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
engine = engine.replace('<title>Cimbar Encoder</title>', '<title>代码桥发送引擎</title>')
engine = engine.replace('⌜ Tap to start! ⌟', '准备好代码包后，点击“开始传输”')
engine = engine.replace('⚠️⚡ PHOTOSENSITIVITY WARNING!', '彩色动画会快速闪动')
engine = engine.replace('Photosensitive epilepsy + flickering light = seizure!', '对闪光敏感的人请避免直视动画区域')
engine = engine.replace('Be safe! Have fun! ⚠️⚡', '手机接收完成后，可点击“停止”')
style = '<style>#nav-container{display:none!important}body{background:white;color:#56657a}#dragdrop{outline:3px solid #111;box-shadow:none}.drop-message{background:#f7faff;color:#56657a;justify-content:center;padding:25px}.drop-message p{font:15px system-ui,sans-serif}.drop-message p:first-of-type{font:18px system-ui,sans-serif}.msg-bottom{margin-top:24px!important}#canvas{visibility:hidden}</style>'
engine = engine.replace('</body>', style + '</body>')

# Retain notices in standalone assets, including the mixed-license source link.
notice_files = [ROOT.parent / 'LICENSE'] + [vendor / name for name in
    ['CIMBAR-LICENSE.txt', 'fflate-LICENSE.txt', 'sha256-LICENSE.txt', 'qrcodegen-LICENSE.txt']]
notice_files += sorted(path for path in (vendor / 'cimbar-notices').iterdir() if path.name != 'sources.json')
notices = '\n\n'.join(path.read_text(encoding='utf-8') for path in notice_files)
notice = '''<!--
Code Bridge v1.2.0: original wrapper MIT; CIMBAR and modifications MPL-2.0.
Local source and patches: https://github.com/1CWwW/code-bridge
Corresponding CIMBAR encoder source: https://github.com/sz3/libcimbar/tree/v0.6.8
Complete notices follow.
''' + notices.replace('-->', '-- >') + '\n-->\n'
engine = engine.replace('<head>', '<head>\n' + notice, 1)
template = (ROOT / 'app.html').read_text(encoding='utf-8')
libraries = '\n'.join('<script>\n' + (vendor / file).read_text(encoding='utf-8').replace('</script', '<\\/script') + '\n</script>' for file in ['fflate.js', 'sha256.js', 'qrcodegen.js'])
html = template.replace('<!--BUNDLED_LIBRARIES-->', libraries).replace('__ENGINE_BASE64__', base64.b64encode(engine.encode()).decode())
html = html.replace('<head>', '<head>\n' + notice, 1)
output = ROOT.parent / 'dist'
output.mkdir(exist_ok=True)
for filename, content in [('code-bridge.html', html), ('cimbar-engine.html', engine)]:
    target = output / filename
    target.write_text(content, encoding='utf-8', newline='\n')
    print(target.relative_to(ROOT.parent))
