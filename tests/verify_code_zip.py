from pathlib import Path
import json, zipfile, hashlib
root=Path(__file__).resolve().parents[1]/'test-results'/'linux-verification'
expected=json.loads((root/'expected.json').read_text(encoding='utf-8'))
with zipfile.ZipFile(root/'code-package.zip') as package:
    assert package.testzip() is None
    for name,text in expected:
        assert package.read(name)==text.encode('utf-8'), name
    assert not any('/target/' in name for name in package.namelist())
    manifest=json.loads(package.read('__scanbridge__/manifest.json'))
    for file in manifest['files']:
        raw=package.read(file['path'])
        assert len(raw)==file['bytes']
        assert hashlib.sha256(raw).hexdigest()==file['sha256']
    context=package.read('__scanbridge__/text-summary.md').decode('utf-8')
    assert '中文😀' in context and '检查 Java 方法' in context
print('PASS: independent ZIP extraction, all original bytes and SHA-256 hashes verified.')
