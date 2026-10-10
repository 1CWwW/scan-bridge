from pathlib import Path
from PIL import Image
import zxingcpp
root=Path(__file__).resolve().parents[1]/'test-results'/'plain-verification'
assert list(root.glob('sample-*-part-*.png')), 'Run npm test before decoding'
count=0
for image in root.glob('sample-*-part-*.png'):
    decoded=zxingcpp.read_barcode(Image.open(image))
    assert decoded is not None,image.name
    assert decoded.bytes==image.with_suffix('.txt').read_bytes(),image.name
    count+=1
for original in root.glob('sample-*.txt'):
    if '-part-' in original.name:continue
    images=sorted(root.glob(original.stem+'-part-*.png'),key=lambda p:int(p.stem.rsplit('-',1)[1]))
    assert b''.join(zxingcpp.read_barcode(Image.open(image)).bytes for image in images)==original.read_bytes()
print(f'PASS: independent ZXing decoder recovered {count} plain QR images byte-for-byte without decompression.')
