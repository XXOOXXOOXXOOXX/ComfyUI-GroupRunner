const {chromium}=require('playwright');
const {spawn}=require('node:child_process');
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const server=spawn(process.env.VC_PYTHON||'python',[path.join(__dirname,'fixture.py')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
let diagnostics='';server.stderr.on('data',chunk=>diagnostics+=chunk.toString());
const ready=new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('fixture timeout '+diagnostics)),45000);server.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n')){clearTimeout(timer);resolve(JSON.parse(output.split('\n')[0]).host)}});server.on('exit',code=>{clearTimeout(timer);reject(new Error('fixture exited '+code+' '+diagnostics))})});
(async()=>{let browser;try{
 const host=await ready,key='a'.repeat(32);
 // A real v1 binding loads before the extension initializes on the page.
 const legacy={version:1,workflow:{identity:'path:A/workflow.json',name:'旧工作流'},rows:[{id:'b'.repeat(32),group:{id:10,title:'自定义音色'},text_node_id:'1',prompt:'旧版保存的音色',count:1},{id:'c'.repeat(32),group:{id:11,title:'图片生成'},text_node_id:'3',prompt:'单个画面提示词',count:1}]};
 const seeded=await fetch(host+'/group_runner/bindings/'+key,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(legacy)});assert.equal(seeded.ok,true);
 browser=await chromium.launch({headless:true,...(process.env.VC_BROWSER_PATH?{executablePath:process.env.VC_BROWSER_PATH}:{})});
 const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.addInitScript(()=>globalThis.fixtureExtraTexts=1);
 await page.goto(host+'/plugin/tests/harness.html');await page.waitForFunction(()=>globalThis.ready);await page.evaluate(()=>GroupRunnerUI.ready);
 const panel=page.getByRole('region',{name:'框运行管理',exact:true}),first=panel.locator('.gr-row').nth(0),second=panel.locator('.gr-row').nth(1);
 // Navigation works independently of Eagle installation and reads the group's current position.
 const jump=panel.getByRole('button',{name:'第 1 行跳转分组',exact:true});assert.equal(await jump.isEnabled(),true);
 await page.evaluate(()=>fixtureApp.graph._groups[0]._bounding=[2100,400,800,300]);await jump.click();
 const centered=await page.evaluate(()=>{const {ds}=fixtureApp.canvas;return{x:(2500+ds.offset[0])*ds.scale,y:(550+ds.offset[1])*ds.scale,scale:ds.scale,width:innerWidth,height:innerHeight,redraws:fixtureApp.canvas.redraws}});
 assert.ok(Math.abs(centered.x-centered.width/2)<.01&&Math.abs(centered.y-centered.height/2)<.01);assert.equal(centered.scale,.7);assert.ok(centered.redraws>0);
 assert.equal(await first.locator('textarea').count(),2);assert.equal(await first.locator('.gr-prompt-line select').count(),2);
 assert.equal(await panel.getByLabel('第 1 行提示词',{exact:true}).inputValue(),'旧版保存的音色');
 assert.equal(await second.locator('.gr-prompt-line select').count(),0);assert.match(await second.locator('.gr-text-name').innerText(),/画面提示词/);
 await panel.getByLabel('第 1 行第 2 个提示词',{exact:true}).fill('独立的第二个文本');
 assert.equal(await page.evaluate(()=>fixtureApp.graph.getNodeById(6).widgets[0].value),'独立的第二个文本');
 // Selecting another name swaps its line; it cannot silently duplicate a target.
 await panel.getByLabel('第 1 行文本节点',{exact:true}).selectOption('6');
 assert.equal(await panel.getByLabel('第 1 行提示词',{exact:true}).inputValue(),'独立的第二个文本');
 assert.equal(await panel.getByLabel('第 1 行第 2 个提示词',{exact:true}).inputValue(),'旧版保存的音色');
 await page.evaluate(()=>addFixtureText(7));await page.waitForFunction(()=>document.querySelector('.gr-row').querySelectorAll('textarea').length===3);
 await panel.getByLabel('第 1 行第 3 个提示词',{exact:true}).fill('第三段提示词\n保留换行');
 const multiline=await panel.getByLabel('第 1 行第 3 个提示词',{exact:true}).boundingBox();assert.ok(multiline.height>=44&&multiline.height<=50,'multiline prompt fits its content without excess padding');
 const measure=async()=>await page.evaluate(()=>{
  const rect=selector=>{const box=document.querySelector(selector).getBoundingClientRect();return{x:box.x,y:box.y,w:box.width,h:box.height,right:box.right,bottom:box.bottom}};
  const panel=rect('.gr-panel'),name=rect('.gr-name'),header=rect('.gr-header'),actions=rect('.gr-header-actions'),main=rect('.gr-row-main'),prompt=rect('.gr-prompt-line'),field=rect('.gr-prompt-line textarea');
  return{panel,name,header,actions,main,prompt,field,overflow:[...document.querySelectorAll('.gr-row,.gr-header,.gr-prompt-line')].some(node=>node.scrollWidth>node.clientWidth+1),buttons:[...document.querySelectorAll('.gr-header button,.gr-row-main button,.gr-row-main input')].map(node=>node.getBoundingClientRect().height)};
 });
 let layout=await measure();assert.ok(Math.abs(layout.name.x+layout.name.w/2-(layout.header.x+layout.header.w/2))<2,'workflow name centered in header');
 assert.ok(layout.actions.right>layout.header.right-15,'actions aligned right');assert.ok(layout.prompt.y>=layout.main.bottom+4,'prompts below main controls');
 assert.ok(layout.buttons.every(height=>height<=28),'controls have compact vertical padding');assert.ok(layout.field.h<=30);assert.equal(layout.overflow,false);
 for(const label of ['保存当前工作流绑定','删除当前工作流绑定','刷新分组及工作流绑定']){const control=panel.getByRole('button',{name:label,exact:true});assert.equal(await control.locator('svg').count(),1);assert.equal(await control.innerText(),'');}
 await panel.getByRole('button',{name:'保存当前工作流绑定',exact:true}).click();await page.waitForFunction(()=>!GroupRunnerUI.saving);
 let saved=await(await fetch(host+'/group_runner/bindings')).json();assert.equal(saved.bindings[key].version,3);assert.deepEqual(saved.bindings[key].rows[0].prompts.map(entry=>entry.text_node_id),['6','1','7']);
 // The queue must write every saved draft even after a native node value changes.
 await page.evaluate(()=>{for(const node of fixtureApp.graph._nodes)if(node.type==='GroupRunnerText')node.widgets[0].value='external change'});
 await panel.getByRole('button',{name:'运行第 1 行',exact:true}).click();await page.waitForFunction(()=>GroupRunnerUI.runner.jobs[0]?.state==='done',{},{timeout:15000});
 const stats=await(await fetch(host+'/tests/stats')).json();assert.equal(stats.submitted,1);const record=stats.records[0];
 for(const [id,text]of [['1','旧版保存的音色'],['6','独立的第二个文本'],['7','第三段提示词\n保留换行']]){assert.equal(record.prompt[id].inputs.text,text);assert.equal(record.values[id],text);}
 assert.equal(record.prompt['5'],undefined);
 for(const width of [800,600,500,375]){await page.setViewportSize({width,height:850});await page.waitForFunction(()=>document.querySelector('.gr-panel').getBoundingClientRect().right<=innerWidth);layout=await measure();assert.equal(layout.overflow,false,'no overflow at '+width);assert.ok(layout.panel.right<=width,JSON.stringify({width,layout}));}
 await page.setViewportSize({width:1500,height:950});await page.waitForFunction(()=>document.querySelector('.gr-panel').getBoundingClientRect().width===1200);
 const shots=path.join(__dirname,'screenshots');fs.mkdirSync(shots,{recursive:true});await panel.screenshot({path:path.join(shots,'panel.png')});
 // Reconstructed graph has the same nodes before extension initialization.
 await page.addInitScript(()=>globalThis.fixtureExtraTexts=2);await page.reload();await page.waitForFunction(()=>globalThis.ready);await page.evaluate(()=>GroupRunnerUI.ready);
 assert.equal(await first.locator('textarea').count(),3);assert.equal(await panel.getByLabel('第 1 行提示词',{exact:true}).inputValue(),'独立的第二个文本');
 assert.equal(await panel.getByLabel('第 1 行第 3 个提示词',{exact:true}).inputValue(),'第三段提示词\n保留换行');
 // Removing text nodes rescans automatically, retains surviving drafts, and hides the dropdown for one node.
 await page.evaluate(()=>{const graph=fixtureApp.graph;graph._nodes=graph._nodes.filter(node=>![6,7].includes(node.id));graph._groups[0].nodes=graph._groups[0].nodes.filter(node=>![6,7].includes(node.id))});
 await page.waitForFunction(()=>document.querySelector('.gr-row').querySelectorAll('textarea').length===1);
 assert.equal(await first.locator('.gr-prompt-line select').count(),0);assert.equal(await panel.getByLabel('第 1 行提示词',{exact:true}).inputValue(),'旧版保存的音色');
 await page.evaluate(()=>{const row=GroupRunnerUI.rows[0];GroupRunnerUI.runner.jobs.push({row:structuredClone(row),state:'running',done:0,message:'test running'});GroupRunnerUI.updateJobs()});assert.equal(await jump.isEnabled(),true);await jump.click();
 await page.evaluate(()=>{GroupRunnerUI.runner.jobs=[];fixtureApp.graph._groups=fixtureApp.graph._groups.filter(group=>group.id!==10)});await page.waitForFunction(()=>document.querySelector('.gr-jump').disabled);assert.equal(await jump.isDisabled(),true);
 assert.equal(errors.length,0,errors.join('\n'));await page.evaluate(()=>GroupRunnerUI.destroy());
 console.log('MULTI TEXT UI PASS: legacy migration, independent per-node drafts and actual HTTP execution, automatic additions/removal, dropdown order, save/reload, centered icons/compact layout and 375–1500px viewports. Simulated ComfyUI.');
}finally{if(browser)await browser.close();server.stdin.end('\n');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));}})().catch(error=>{console.error(error,diagnostics);process.exitCode=1});

