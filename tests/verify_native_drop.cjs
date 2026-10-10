const {chromium}=require('playwright');
const { appUrl, launchOptions, results } = require('./helpers.cjs');
const fs=require('fs'),path=require('path'),assert=require('assert');
(async()=>{
  fs.mkdirSync(path.join(results,'linux-verification'),{recursive:true});
  const fixture=path.join(results,'native-drop');fs.mkdirSync(path.join(fixture,'src'),{recursive:true});fs.mkdirSync(path.join(fixture,'target'),{recursive:true});
  const java='class Hello { String text = "中文😀"; }\r\n';
  fs.writeFileSync(path.join(fixture,'src','Hello.java'),java);
  fs.writeFileSync(path.join(fixture,'src','中文😀.java'),'// 符号 & < >\nclass Test {}\n');
  fs.writeFileSync(path.join(fixture,'empty.txt'),'');
  fs.writeFileSync(path.join(fixture,'target','ignored.class'),'ignored');
  const browser=await chromium.launch(launchOptions);
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(appUrl);await page.locator('#mode').selectOption('files');await page.waitForFunction(()=>engineReady);
  const session=await page.context().newCDPSession(page);
  async function diskDrop(files){const data={items:[],files,dragOperationsMask:1};for(const type of ['dragEnter','dragOver','drop'])await session.send('Input.dispatchDragEvent',{type,x:220,y:270,data});}
  await diskDrop([path.join(fixture,'src','Hello.java'),path.join(fixture,'src','中文😀.java')]);
  await page.waitForFunction(()=>selected.size===2);
  await page.locator('#prepare').click();await page.waitForFunction(()=>CodeBridge.getPackage());
  const direct=await page.evaluate(()=>{
    const data=fflate.unzipSync(CodeBridge.getPackage().bytes);
    return Object.fromEntries(Object.entries(data).filter(([name])=>!name.startsWith('__codebridge__/')).map(([name,bytes])=>[name,new TextDecoder().decode(bytes)]));
  });assert.equal(direct['Hello.java'],java);assert.equal(Object.keys(direct).length,2);
  await page.locator('#clear').click();
  await diskDrop([fixture]);await page.waitForFunction(()=>selected.size===4);
  await page.locator('#prepare').click();await page.waitForFunction(()=>CodeBridge.getPackage());
  const directory=await page.evaluate(()=>{
    const data=fflate.unzipSync(CodeBridge.getPackage().bytes);
    return {paths:Object.keys(data),bytes:Array.from(CodeBridge.getPackage().bytes),count:CodeBridge.getPackage().fileCount};
  });assert.equal(directory.count,3);assert(directory.paths.includes('native-drop/src/中文😀.java'));assert(directory.paths.includes('native-drop/empty.txt'));assert(!directory.paths.some(name=>name.includes('/target/')));
  fs.writeFileSync(path.join(results,'linux-verification','native-drop.zip'),Buffer.from(directory.bytes));
  // Exercise the legacy EncodingError branch, and ensure actionable recovery with no partial add.
  const legacy=await page.evaluate(async()=>{
    let called=false;
    const bad={name:'folder',isDirectory:true,createReader:()=>({readEntries:(resolve,reject)=>reject(new DOMException('A URI supplied to the API was malformed','EncodingError'))})};
    let message='';try{await CodeBridge.readDropped([{entry:bad,file:null,handle:null}],[]);}catch(error){message=error.message;}
    const ordinary=new File(['class Safe {}'],'Safe.java');
    const source={kind:'file',getAsFile:()=>ordinary,webkitGetAsEntry:()=>({isFile:true,file:()=>{called=true;throw new Error('Must not use entry.file');}})};
    const items=await CodeBridge.readDropped(CodeBridge.captureDrop({items:[source]}),[]);
    return {message,called,name:items[0].file.name};
  });assert(legacy.message.includes('选择文件夹'));assert.equal(legacy.called,false);assert.equal(legacy.name,'Safe.java');
  await page.locator('#clear').click();
  await page.locator('#folderpicker').setInputFiles(fixture);await page.waitForFunction(()=>selected.size===4);
  assert(await page.locator('#files').textContent().then(text=>text.includes('native-drop/src/Hello.java')));
  await browser.close();assert.deepEqual(errors,[]);
  console.log('PASS: native disk file/folder drops, Unicode paths, original bytes, empty files, folder picker, and legacy error recovery.');
})().catch(error=>{console.error(error);process.exit(1)});
