const { chromium } = require('playwright');
const { appUrl, launchOptions, results } = require('./helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

(async () => {
  const root = path.join(results, 'documents');
  const files = ['会议纪要.docx', '统计表.xlsx', '演示文稿.pptx', '附件.pdf', '示意图.png', '普通文本.txt', '原始数据.bin'];
  assert(files.every(name => fs.existsSync(path.join(root, name))), 'Run python tests/create_documents.py first');
  const browser = await chromium.launch(launchOptions);
  const page = await browser.newPage({ viewport: { width: 1400, height: 1050 } });
  const errors = [], network = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
  await page.goto(appUrl);
  await page.locator('#mode').selectOption('files');
  await page.waitForFunction(() => engineReady);
  assert.equal(await page.locator('#ignore').isChecked(), false);
  assert.equal(await page.locator('#context').isChecked(), false);
  assert.equal(await page.locator('#packaging').inputValue(), 'auto');
  for (const name of files) {
    await page.locator('#clear').click();
    await page.locator('#filepicker').setInputFiles(path.join(root, name));
    await page.locator('#prepare').click();
    await page.waitForFunction(() => ScanBridge.getPackage() !== null);
    const packed = await page.evaluate(() => {
      const p = ScanBridge.getPackage();
      return { bytes: Array.from(p.bytes), fileName: p.fileName, sha256: p.sha256, archive: p.archive };
    });
    assert.equal(packed.fileName, name);
    assert.equal(packed.archive, false);
    const expected = fs.readFileSync(path.join(root, name));
    assert.deepEqual(Buffer.from(packed.bytes), expected);
    assert.equal(packed.sha256, crypto.createHash('sha256').update(expected).digest('hex'));
    const pending = page.waitForEvent('download');
    await page.locator('#download').click();
    const download = await pending;
    assert.equal(download.suggestedFilename(), name);
    await download.saveAs(path.join(root, 'received-' + name));
  }
  // The actual encoder receives the original name, MIME and bytes for a document.
  await page.evaluate(() => {
    const win = document.getElementById('engine').contentWindow;
    const original = win.Main.importFile.bind(win.Main);
    win.Main.importFile = file => {
      window.sentDocument = { name: file.name, type: file.type, size: file.size };
      return original(file);
    };
  });
  await page.locator('#clear').click();
  await page.locator('#filepicker').setInputFiles(path.join(root, files[0]));
  await page.locator('#prepare').click();
  await page.waitForFunction(() => ScanBridge.getPackage() !== null);
  await page.locator('#start').click();
  assert.equal((await page.evaluate(() => sentDocument)).name, files[0]);
  await page.locator('#stop').click();
  // A forced ZIP must preserve one document just as the automatic batch does.
  await page.locator('#packaging').selectOption('zip');
  assert.equal(await page.evaluate(() => ScanBridge.getPackage()), null);
  await page.locator('#prepare').click();
  await page.waitForFunction(() => ScanBridge.getPackage() !== null);
  assert.equal(await page.evaluate(() => ScanBridge.getPackage().archive), true);
  await page.locator('#packaging').selectOption('auto');
  await page.locator('#clear').click();
  await page.locator('#filepicker').setInputFiles(files.map(name => path.join(root, name)));
  await page.evaluate(() => ScanBridge.addFiles([
    { path: '办公资料/build/附件.bin', file: new File([new Uint8Array([0, 255, 128, 10])], '附件.bin') },
    { path: '办公资料/empty.txt', file: new File([], 'empty.txt') },
  ]));
  await page.locator('#prepare').click();
  await page.waitForFunction(() => ScanBridge.getPackage() !== null);
  const batch = await page.evaluate(() => {
    const p = ScanBridge.getPackage();
    return { bytes: Array.from(p.bytes), archive: p.archive, count: p.fileCount };
  });
  assert.equal(batch.archive, true);
  assert.equal(batch.count, 9);
  fs.writeFileSync(path.join(root, 'office-package.zip'), Buffer.from(batch.bytes));
  await page.locator('#start').click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(root, 'file-transfer.png'), fullPage: true });
  await page.locator('#stop').click();
  // Empty files and folders must remain recoverable through ZIP, including one file.
  await page.locator('#clear').click();
  await page.locator('#filepicker').setInputFiles(path.join(root, 'empty.txt'));
  await page.locator('#prepare').click();
  await page.waitForFunction(() => ScanBridge.getPackage() !== null);
  assert.equal(await page.evaluate(() => ScanBridge.getPackage().archive), true);
  await page.locator('#clear').click();
  await page.evaluate(() => ScanBridge.addFiles([{ path: 'folder/report.txt', file: new File(['report'], 'report.txt') }]));
  await page.locator('#prepare').click();
  await page.waitForFunction(() => ScanBridge.getPackage() !== null);
  assert.equal(await page.evaluate(() => ScanBridge.getPackage().archive), true);
  // Expose literal filenames to the engine instead of interpreting them as HTML.
  await page.locator('#clear').click();
  const literal = '<img src=x onerror=alert(1)>.bin';
  await page.evaluate(name => ScanBridge.addFiles([{ file: new File([new Uint8Array([1, 0, 255])], name) }]), literal);
  await page.locator('#prepare').click();
  await page.waitForFunction(() => ScanBridge.getPackage() !== null);
  await page.locator('#start').click();
  assert.equal(await page.frameLocator('#engine').locator('#current-file').textContent(), literal);
  assert.equal(await page.frameLocator('#engine').locator('#current-file img').count(), 0);
  await page.locator('#stop').click();
  for (const kind of ['auto', 'ios', 'android', 'other']) {
    await page.locator('#phone').selectOption(kind);
    assert((await page.locator('#receiver-guide').textContent()).length > 10);
    assert.equal(await page.locator('#android-receiver').isVisible(), kind === 'android');
  }
  await browser.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(network, []);
  console.log('PASS: office/PDF/image/text/binary originals, downloads, automatic and forced ZIP, ordinary build folders, empty files, literal filenames, and phone receiver guides.');
})().catch(error => { console.error(error); process.exit(1); });
