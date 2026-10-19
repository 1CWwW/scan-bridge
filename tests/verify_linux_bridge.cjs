const { chromium } = require('playwright');
const { appUrl, launchOptions, results } = require('./helpers.cjs');
const fs=require('fs'), path=require('path'), crypto=require('crypto'), assert=require('assert');
(async()=>{
  fs.mkdirSync(path.join(results,'linux-verification'),{recursive:true});
  const out=path.join(results,'linux-verification');fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch(launchOptions);
  const page=await browser.newPage({viewport:{width:1440,height:1120}});
  const errors=[], requests=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  await page.goto(appUrl);
  await page.locator('#mode').selectOption('files');
  await page.waitForFunction(()=>engineReady,{timeout:30000});
  await page.locator('#ignore').check();await page.locator('#context').check();
  const result=await page.evaluate(async()=>{
    const data=[['demo/src/main/java/Hello.java','package demo;\r\npublic class Hello {\r\n  // 中文😀\r\n  String name = "<tag> & 测试";\r\n}\r\n'],['demo/pom.xml','<project>\n  <name>测试</name>\n</project>\n'],['demo/empty.txt',''],['demo/target/ignored.class','SHOULD NOT BE INCLUDED']];
    const large=Array.from({length:400},(_,i)=>'    public String method'+i+'(String value) { return "value-'+i+'" + value; }').join('\n');
    data.push(['demo/src/main/java/Large.java','package demo;\npublic class Large {\n'+large+'\n}\n']);
    CodeBridge.addFiles(data.map(([name,content])=>({path:name,file:new File([content],name.split('/').pop())})));
    document.getElementById('text').value='请检查 Java 方法，返回 unified diff。\n';
    await CodeBridge.buildPackage();
    const p=CodeBridge.getPackage();
    if(!p)throw new Error(document.getElementById('status').textContent);
    return {bytes:Array.from(p.bytes),sha256:p.sha256,rawSize:p.rawSize,count:p.fileCount,expected:data.filter(([name])=>!name.includes('/target/'))};
  });
  fs.writeFileSync(path.join(out,'code-package.zip'),Buffer.from(result.bytes));
  assert.equal(crypto.createHash('sha256').update(Buffer.from(result.bytes)).digest('hex'),result.sha256);
  fs.writeFileSync(path.join(out,'expected.json'),JSON.stringify(result.expected));
  // Exercise a large fountain stream, in addition to the highly compressible Java sample.
  const noise=crypto.randomBytes(50000).toString('hex');
  await page.evaluate(async noise=>{
    CodeBridge.addFiles([{path:'demo/entropy-test.txt',file:new File([noise],'entropy-test.txt')}]);
    await CodeBridge.buildPackage();
  },noise);
  await page.locator('#start').click();
  await page.waitForTimeout(1600);
  const first=await page.frameLocator('#engine').locator('#canvas').screenshot();
  fs.writeFileSync(path.join(out,'frame-1.png'),first);
  await page.waitForTimeout(800);
  const second=await page.frameLocator('#engine').locator('#canvas').screenshot();
  fs.writeFileSync(path.join(out,'frame-2.png'),second);
  assert(!first.equals(second),'Animated frames did not change');
  await page.screenshot({path:path.join(out,'sender.png'),fullPage:true});
  await page.locator('#stop').click();
  assert.equal(await page.locator('#start').isDisabled(),false);
  assert.equal(await page.locator('#stop').isDisabled(),true);
  // Restart works and newly edited text invalidates the previously prepared archive.
  await page.locator('#start').click();await page.waitForTimeout(200);
  await page.locator('#text-label').click();
  await page.locator('#text').fill('修改后的说明');
  assert.equal(await page.locator('#start').isDisabled(),true);
  assert.equal(await page.evaluate(()=>CodeBridge.getPackage()),null);
  const rejection=await page.evaluate(()=>{
    const outcomes=[];
    for(const name of ['../escape.java','/abs.java','C:/bad.java','__scanbridge__/manifest.json']){try{CodeBridge.pathName(name);outcomes.push(false);}catch{outcomes.push(true);}}
    try{CodeBridge.addFiles([{path:'demo/pom.xml',file:new File(['duplicate'],'pom.xml')}]);outcomes.push(false);}catch{outcomes.push(true);}
    return outcomes;
  });assert(rejection.every(Boolean),'Unsafe or duplicate paths accepted');
  await page.locator('#clear').click();
  const transfer=await page.evaluateHandle(()=>{
    const dt=new DataTransfer();dt.items.add(new File(['class Dragged {}\n'],'Dragged.java'));dt.items.add(new File(['<project/>'],'pom.xml'));return dt;
  });
  await page.dispatchEvent('#drop','drop',{dataTransfer:transfer});
  await page.waitForFunction(()=>selected.size===2);
  await page.locator('#prepare').click();
  await page.waitForFunction(()=>CodeBridge.getPackage()!==null);
  assert.equal(await page.evaluate(()=>CodeBridge.getPackage().fileCount),2,'Actual drop event failed');
  const folderTest=await page.evaluate(async()=>{
    const leaf=name=>({name,isFile:true,file:resolve=>resolve(new File(['class '+name+' {}'],name))});
    let batch=0;const dir={name:'src',isDirectory:true,createReader:()=>({readEntries:resolve=>resolve(batch++===0?[leaf('A.java')]:batch===2?[leaf('B.java')]:[])})};
    return (await CodeBridge.walk(dir)).map(item=>item.path);
  });assert.deepEqual(folderTest,['src/A.java','src/B.java'],'Multi-batch folder recursion failed');
  await page.setViewportSize({width:1366,height:768});
  await page.screenshot({path:path.join(out,'sender-laptop.png'),fullPage:true});
  await browser.close();
  assert.deepEqual(errors,[],'Browser errors');assert.deepEqual(requests,[],'Sender made network requests');
  console.log(JSON.stringify({pass:true,rawBytes:result.rawSize,zipBytes:result.bytes.length,originalFiles:result.count,networkRequests:requests.length,tests:'Offline ZIP, SHA-256, actual file drop, directory recursion/filtering, animations, stop/restart, edit invalidation, path validation'}));
})().catch(err=>{console.error(err);process.exit(1);});
