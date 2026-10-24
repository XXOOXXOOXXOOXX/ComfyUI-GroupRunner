const {chromium}=require('playwright'),{spawn}=require('node:child_process'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const server=spawn(process.env.VC_PYTHON||'python',[path.join(__dirname,'fixture.py')],{stdio:['pipe','pipe','pipe'],windowsHide:true});let diagnostics='';server.stderr.on('data',chunk=>diagnostics+=chunk);
const ready=new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('fixture timeout '+diagnostics)),45000);server.stdout.on('data',chunk=>{output+=chunk;if(output.includes('\n')){clearTimeout(timer);resolve(JSON.parse(output.split('\n')[0]).host);}});server.on('exit',code=>{clearTimeout(timer);reject(new Error('fixture exited '+code+' '+diagnostics));});});
(async()=>{let browser;try{
    const host=await ready;browser=await chromium.launch({headless:true,executablePath:process.env.VC_BROWSER_PATH});const page=await browser.newPage({viewport:{width:1500,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.goto(host+'/plugin/tests/harness.html');await page.waitForFunction(()=>globalThis.ready);await page.evaluate(()=>GroupRunnerUI.ready);
    const panel=page.getByRole('region',{name:'框运行管理'}),rows=panel.locator('.gr-row'),order=()=>rows.evaluateAll(elements=>elements.map(element=>element.dataset.rowId));
    const choose=async(index,title)=>{await panel.getByRole('button',{name:`第 ${index} 行选择分组`,exact:true}).dblclick();await page.getByLabel('搜索分组',{exact:true}).fill(title);await page.getByRole('button',{name:new RegExp('^选择分组 .* '+title+'$')}).click();};
    await panel.getByLabel('控制数量',{exact:true}).fill('3');await panel.getByLabel('控制数量',{exact:true}).press('Tab');
    await choose(1,'自定义音色');await choose(2,'图片生成');await choose(3,'自定义音色');
    await panel.getByLabel('第 1 行提示词',{exact:true}).fill('A 提示词');await panel.getByLabel('第 2 行提示词',{exact:true}).fill('B 提示词');await panel.getByLabel('第 3 行提示词',{exact:true}).fill('C 提示词');
    await panel.getByLabel('第 2 行运行次数',{exact:true}).fill('2');await panel.getByLabel('第 2 行运行次数',{exact:true}).press('Tab');
    await page.evaluate(()=>{const row=GroupRunnerUI.rows[1];row.prompts[0].variants=['B 提示词','B 第二风格'];row.eagle={save_eagle:false,save_output:true,folder_id:'test-folder',folder_label:'测试目录',filename_prefix:'作品/B',annotation:true,tags:true};GroupRunnerUI.render();});
    const original=await page.evaluate(()=>structuredClone(GroupRunnerUI.rows)),[a,b,c]=original.map(row=>row.id);
    const drag=async(from,to,after=true)=>{const handle=await rows.nth(from).locator('.gr-row-handle').boundingBox(),target=await rows.nth(to).boundingBox();await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();await page.mouse.move(target.x+60,target.y+(after?target.height-3:3),{steps:12});assert.equal(await panel.locator('.gr-drop-before,.gr-drop-after').count(),1);await page.mouse.up();};
    await drag(0,2);assert.deepEqual(await order(),[b,c,a]);
    assert.deepEqual(await page.evaluate(()=>GroupRunnerUI.rows),[original[1],original[2],original[0]],'all prompts, variants, batch counts and Eagle settings move with the row');
    assert.equal(await panel.getByLabel('第 1 行提示词',{exact:true}).inputValue(),'B 提示词');assert.equal(await panel.getByLabel('第 1 行运行次数',{exact:true}).inputValue(),'2');assert.equal(await page.evaluate(()=>GroupRunnerUI.dirty),true);
    // Escape cancels without committing the previewed position.
    const h=await rows.nth(0).locator('.gr-row-handle').boundingBox(),bottom=await rows.nth(2).boundingBox();await page.mouse.move(h.x+8,h.y+12);await page.mouse.down();await page.mouse.move(bottom.x+40,bottom.y+bottom.height-3,{steps:8});await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await order(),[b,c,a]);assert.equal(await panel.locator('.gr-row-dragging,.gr-drop-before,.gr-drop-after').count(),0);
    // Keyboard uses the same operation and keeps focus on the moved row.
    await rows.nth(2).locator('.gr-row-handle').press('ArrowUp');assert.deepEqual(await order(),[b,a,c]);await rows.nth(1).locator('.gr-row-handle').press('ArrowDown');assert.deepEqual(await order(),[b,c,a]);
    await panel.getByRole('button',{name:'保存当前工作流绑定',exact:true}).click();await page.waitForFunction(()=>GroupRunnerUI.bindingId&&!GroupRunnerUI.saving);await page.reload();await page.waitForFunction(()=>globalThis.ready);await page.evaluate(()=>GroupRunnerUI.ready);assert.deepEqual(await order(),[b,c,a]);
    assert.deepEqual(await page.evaluate(()=>GroupRunnerUI.rows),[original[1],original[2],original[0]]);
    // Reorder pending rows during execution. The current row completes all its
    // variants/repeats before the remaining rows follow the new order.
    await panel.getByRole('button',{name:'按行整体运行',exact:true}).click();await page.waitForFunction(()=>GroupRunnerUI.runner.current?.state==='running');const current=await page.evaluate(()=>GroupRunnerUI.runner.current.id);
    await drag(2,0,false);assert.deepEqual(await order(),[a,b,c]);assert.equal(await page.evaluate(()=>GroupRunnerUI.runner.current.id),current);
    await page.waitForFunction(()=>!GroupRunnerUI.runner.busy&&GroupRunnerUI.runner.jobs.length===3,null,{timeout:25000});
    const stats=await(await fetch(host+'/tests/stats?t='+Date.now())).json();assert.deepEqual(stats.records.map(record=>record.workflow.extra.group_runner_run.row),[b,b,b,b,a,c]);
    assert.deepEqual(stats.records.slice(0,4).map(record=>record.prompt['3'].inputs.text),['B 提示词','B 提示词','B 第二风格','B 第二风格']);assert.equal(stats.records[4].prompt['1'].inputs.text,'A 提示词');assert.equal(stats.records[5].prompt['1'].inputs.text,'C 提示词');
    // Workflow drafts retain their independent order.
    await page.evaluate(()=>{switchWorkflow('B');GroupRunnerUI.syncWorkflow();});assert.equal(await rows.count(),1);await page.evaluate(()=>{switchWorkflow('A');GroupRunnerUI.syncWorkflow();});assert.deepEqual(await order(),[a,b,c]);
    // Drag to the bottom edge and keep holding to reach offscreen rows.
    await panel.getByLabel('控制数量',{exact:true}).fill('12');await panel.getByLabel('控制数量',{exact:true}).press('Tab');const first=await rows.nth(0).locator('.gr-row-handle').boundingBox(),list=await panel.locator('.gr-rows').boundingBox();await page.mouse.move(first.x+8,first.y+12);await page.mouse.down();await page.mouse.move(list.x+40,list.y+list.height-4,{steps:10});await page.waitForTimeout(1500);assert.ok(await panel.locator('.gr-rows').evaluate(element=>element.scrollTop)>100);await page.mouse.up();assert.equal((await order()).at(-1),a);
    await page.setViewportSize({width:375,height:850});assert.equal(await panel.evaluate(element=>element.scrollWidth>element.clientWidth),false);await page.setViewportSize({width:1500,height:950});
    await page.evaluate(()=>{GroupRunnerUI.rows=GroupRunnerUI.rows.filter(row=>row.group);GroupRunnerUI.render();GroupRunnerUI.list.scrollTop=0;});const shots=path.join(__dirname,'screenshots');fs.mkdirSync(shots,{recursive:true});await panel.screenshot({path:path.join(shots,'reorder-panel.png')});
    assert.deepEqual(errors,[]);await page.evaluate(()=>GroupRunnerUI.destroy());console.log('GROUP RUNNER REORDER PASS: pointer/keyboard, Escape, settings/variants preserved, saved reload and workflow drafts, running row retained, pending rows reordered through real HTTP submissions, edge autoscroll and mobile layout.');
}finally{if(browser)await browser.close();server.stdin.end('\n');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));}})().catch(error=>{console.error(error,diagnostics);process.exitCode=1;});
