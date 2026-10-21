const { chromium } = require('playwright');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const HOST='http://127.0.0.1:8199';
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.VC_BROWSER_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 try{
  const page=await browser.newPage({viewport:{width:1600,height:1100}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(HOST);await page.waitForFunction(()=>globalThis.GroupRunnerUI?.runner?.nodeDefs&&globalThis.comfyAPI?.app?.app?.vueAppReady&&comfyAPI.app.app.isGraphReady,{}, {timeout:60000});await page.waitForTimeout(1500);
  await page.evaluate(async()=>{
   const {app}=await import('/scripts/app.js');
   await app.loadGraphData({version:.4,last_node_id:1,last_link_id:0,nodes:[{id:1,type:'GroupRunnerText',pos:[80,400],size:[550,170],flags:{},order:0,mode:0,inputs:[],outputs:[{name:'text',type:'STRING',links:null}],properties:{'Node name for S&R':'GroupRunnerText'},widgets_values:['风格一']}],links:[],groups:[{id:1,title:'室内风格测试',bounding:[40,350,680,500],color:'#3f789e',font_size:24,flags:{}}],config:{},extra:{}});
   GroupRunnerUI.syncWorkflow(true);
  });
  const panel=page.getByRole('region',{name:'框运行管理',exact:true});await panel.getByRole('button',{name:'第 1 行选择分组',exact:true}).dblclick();await page.getByLabel('搜索分组',{exact:true}).fill('室内风格测试');await page.getByRole('button',{name:/^选择分组 .* 室内风格测试$/}).click();
  await panel.getByLabel('第 1 行提示词',{exact:true}).dblclick();const dialog=page.getByRole('dialog',{name:'批量提示词 · 框运行 · 通用文本',exact:true});
  await dialog.getByLabel('批量提示词文本框数量',{exact:true}).fill('5');await dialog.getByLabel('批量提示词文本框数量',{exact:true}).press('Tab');
  for(let i=0;i<5;i++)await dialog.getByLabel('批量提示词 '+(i+1),{exact:true}).fill(['北欧风格','中古风格','现代风格','法式风格','侘寂风格'][i]);
  await page.locator('.gr-cover').click({position:{x:5,y:5}});
  const drafts=await page.evaluate(()=>{const node=comfyAPI.app.app.graph.getNodeById(1);return{fields:node.groupRunnerVariants.fields.map(({field})=>field.value),values:JSON.parse(JSON.stringify(node.properties.group_runner_prompts)),widgets:node.widgets.map(w=>({name:w.name,serialize:w.options?.serialize}))};});
  assert.deepEqual(drafts.fields,['中古风格','现代风格','法式风格','侘寂风格']);assert.equal(drafts.values.length,5);assert.equal(drafts.widgets.find(w=>w.name==='group_runner_variants').serialize,false);
  await panel.getByRole('button',{name:'保存当前工作流绑定',exact:true}).click();await page.waitForFunction(()=>GroupRunnerUI.bindingId&&!GroupRunnerUI.saving);
  await panel.getByRole('button',{name:'运行第 1 行',exact:true}).click();await page.waitForFunction(()=>GroupRunnerUI.runner.jobs.at(-1)?.state==='done'||GroupRunnerUI.runner.jobs.at(-1)?.state==='error',{}, {timeout:30000});
  const job=await page.evaluate(()=>{const job=GroupRunnerUI.runner.jobs.at(-1);return{state:job.state,message:job.message,done:job.done,total:job.total,id:job.id};});assert.equal(job.state,'done',JSON.stringify(job));assert.equal(job.done,5);
  const history=await(await fetch(HOST+'/history')).json(),records=Object.values(history).filter(record=>record.prompt?.[3]?.extra_pnginfo?.workflow?.extra?.group_runner_run?.job===job.id).sort((a,b)=>a.prompt[0]-b.prompt[0]);
  assert.deepEqual(records.map(record=>record.prompt[2]['1'].inputs.text),['北欧风格','中古风格','现代风格','法式风格','侘寂风格']);
  await page.evaluate(async()=>{const {app}=await import('/scripts/app.js');const saved=app.graph.serialize();await app.loadGraphData(saved);});await page.waitForFunction(()=>comfyAPI.app.app.graph.getNodeById(1)?.groupRunnerVariants?.fields.length===4);await page.waitForTimeout(600);
  await page.waitForFunction(()=>document.querySelector('.gr-multiplier')?.textContent==='×5');
  await page.evaluate(()=>{const app=comfyAPI.app.app;app.canvas.ds.scale=.8;app.canvas.centerOnNode(app.graph.getNodeById(1));app.canvas.setDirty(true,true);});
  const shots=path.join(__dirname,'screenshots');fs.mkdirSync(shots,{recursive:true});await page.screenshot({path:path.join(shots,'variants-native.png')});
  assert.deepEqual(errors,[]);console.log('NATIVE GROUP VARIANTS PASS: modal, real extra node textboxes, five actual targeted ComfyUI executions, metadata and workflow reload.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
