from pathlib import Path
import hashlib
import importlib.util
import json
import tarfile

repo=Path(__file__).resolve().parents[1]
root=repo/'test-results/large-files'
spec=importlib.util.spec_from_file_location('scan_merge',repo/'dist/merge-parts.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
expected=json.loads((root/'expected.json').read_text(encoding='utf-8'))
parts=[root/name for name in expected['parts']]
target=root/'python-restored.bin'
if target.exists():target.unlink()
module.restore(list(reversed(parts)),target)
assert hashlib.sha256(target.read_bytes()).hexdigest()==expected['sha256']
try:module.restore(parts,target)
except FileExistsError:pass
else:raise AssertionError('Existing destination was overwritten')
for group in [parts[1:],parts+[parts[0]]]:
    try:module.restore(group,root/'must-not-exist.bin')
    except ValueError:pass
    else:raise AssertionError('Invalid part group accepted')
corrupt=root/'corrupt.sbpart'
data=bytearray(parts[0].read_bytes());data[-1]^=1;corrupt.write_bytes(data)
try:module.restore([corrupt]+parts[1:],root/'must-not-exist.bin')
except ValueError:pass
else:raise AssertionError('Corrupt volume accepted')
assert not (root/'must-not-exist.bin').exists()
h=hashlib.sha256()
with (root/'large-package.tar').open('rb') as source:
    while block:=source.read(1024*1024):h.update(block)
assert h.hexdigest()==expected['tarSha256']
with tarfile.open(root/'large-package.tar') as archive:
    assert archive.getnames()==['source.bin','办公资料/build/备份.bin','__scanbridge__/manifest.json']
    manifest=json.load(archive.extractfile('__scanbridge__/manifest.json'))
    for entry in manifest['files']:
        stream=archive.extractfile(entry['path']);h=hashlib.sha256()
        while block:=stream.read(1024*1024):h.update(block)
        assert h.hexdigest()==entry['sha256']==expected['sha256']
print('PASS: independent Python restoration, missing/duplicate/corruption/overwrite rejection, and PAX TAR original bytes/Unicode paths/checksums.')
