const {chromium}=require('playwright');
const { appUrl, launchOptions, results } = require('./helpers.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
  fs.mkdirSync(path.join(results,'linux-verification'),{recursive:true});
  const root=path.join(results,'plain-verification');fs.mkdirSync(root,{recursive:true});
  const browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1366,height:950}});const errors=[],network=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))network.push(r.url());});
  await page.goto(appUrl);
  assert.equal(await page.locator('#mode').inputValue(),'plain');
  assert(await page.locator('#download').isHidden());assert(await page.locator('#start').isHidden());
  const samples=['会议记录\n\n主题：下周活动安排\n1. 周一准备资料\n2. 周三核对预算\n3. 周五确认结果 😀\n',' \t\n  保留空格😀 \'"<>\\\n ',new Array(900).fill('汉').join('')+'😀\nEND',new Array(2200).fill('A').join(''),'package demo;\npublic class Hello {\n  // 中文注释 😀\n  String text = "你好 & <tag>";\n}\n'];
  let qrCount=0;
  for(let i=0;i<samples.length;i++){
    const limit=i===3?'2200':'1200';await page.locator('#plain-limit').selectOption(limit);
    await page.locator('#text').fill(samples[i]);await page.locator('#prepare').click();
    const parts=await page.evaluate(()=>CodeBridge.getPlainParts());
    assert.equal(parts.join(''),samples[i]);assert.equal(await page.evaluate(()=>CodeBridge.getPackage()),null);
    fs.writeFileSync(path.join(root,'sample-'+i+'.txt'),samples[i]);
    for(let j=0;j<parts.length;j++){
      assert(Buffer.byteLength(parts[j],'utf8')<=Number(limit));
      const png=await page.evaluate(()=>{const canvas=document.createElement('canvas');drawQr(canvas,plainQr,8);return canvas.toDataURL('image/png').split(',')[1];});
      fs.writeFileSync(path.join(root,'sample-'+i+'-part-'+j+'.png'),Buffer.from(png,'base64'));
      fs.writeFileSync(path.join(root,'sample-'+i+'-part-'+j+'.txt'),parts[j]);qrCount++;
      if(j+1<parts.length)await page.locator('#next').click();
    }
    assert(await page.locator('#next').isDisabled());
    if(i===0)await page.screenshot({path:path.join(root,'direct-text.png'),fullPage:true});
  }
  // Preserve Unicode pairs and CRLF atomically in the splitter, including byte boundaries.
  const boundaries=await page.evaluate(()=>[CodeBridge.splitPlain('A'.repeat(1199)+'😀\r\n中',1200),CodeBridge.splitPlain('A'.repeat(1199)+'\r\nB',1200)]);
  assert.equal(boundaries[0][1],'😀\r\n中');assert.equal(boundaries[1][1],'\r\nB');
  await page.locator('#text').fill('edited');assert(await page.locator('#plainqr').isHidden());assert(await page.locator('#save-plain').isDisabled());
  await page.locator('#prepare').click();const downloadPromise=page.waitForEvent('download');await page.locator('#save-plain').click();const download=await downloadPromise;assert(download.suggestedFilename().endsWith('.png'));
  await page.locator('#clear-text').click();await page.locator('#prepare').click();assert(await page.locator('#plainqr').isHidden());
  await page.locator('#mode').selectOption('files');assert(await page.locator('#plain-help').isHidden());assert(await page.locator('#file-help').isVisible());
  await page.locator('#mode').selectOption('plain');assert(await page.locator('#plain-help').isVisible());
  await browser.close();assert.deepEqual(errors,[]);assert.deepEqual(network,[]);
  console.log('PASS: '+qrCount+' plain QR images, multipart navigation, Unicode, whitespace, code bytes, PNG export, edit invalidation, empty input and mode switching.');
})().catch(error=>{console.error(error);process.exit(1)});
