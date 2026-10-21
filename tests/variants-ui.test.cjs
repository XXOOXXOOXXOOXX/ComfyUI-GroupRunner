const { chromium } = require('playwright'), { spawn } = require('node:child_process');
const assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const server = spawn(process.env.VC_PYTHON || 'python', [path.join(__dirname, 'fixture.py')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
let diagnostics = ''; server.stderr.on('data', data => diagnostics += data);
const ready = new Promise((resolve, reject) => { let text = ''; const timer = setTimeout(() => reject(Error(diagnostics)), 45000); server.stdout.on('data', data => { text += data; if (text.includes('\n')) { clearTimeout(timer); resolve(JSON.parse(text.split('\n')[0]).host); } }); server.on('exit', code => { clearTimeout(timer); reject(Error('Fixture exited '+code+diagnostics)); }); });
(async()=>{let browser;try{
 const host=await ready;browser=await chromium.launch({headless:true,executablePath:process.env.VC_BROWSER_PATH});const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(host+'/plugin/tests/harness.html');await page.waitForFunction(()=>globalThis.ready);await page.evaluate(()=>GroupRunnerUI.ready);
 const panel=page.getByRole('region',{name:'框运行管理',exact:true});
 await panel.getByRole('button',{name:'第 1 行选择分组',exact:true}).dblclick();await page.getByLabel('搜索分组',{exact:true}).fill('自定义音色');await page.getByRole('button',{name:/^选择分组 .* 自定义音色$/}).click();
 await panel.getByLabel('第 1 行提示词',{exact:true}).fill('风格一');await panel.getByLabel('第 1 行提示词',{exact:true}).dblclick();
 const dialog=page.getByRole('dialog',{name:'批量提示词 · 音色提示词',exact:true});
 await dialog.getByLabel('批量提示词文本框数量',{exact:true}).fill('6');await dialog.getByLabel('批量提示词文本框数量',{exact:true}).press('Tab');
 for(const [index,text]of ['风格一','风格二','','风格三','风格四','风格五'].entries())await dialog.getByLabel('批量提示词 '+(index+1),{exact:true}).fill(text);
 assert.match(await dialog.innerText(),/已填写 5 条/);
 const shots=path.join(__dirname,'screenshots');fs.mkdirSync(shots,{recursive:true});await dialog.screenshot({path:path.join(shots,'variants-dialog.png')});
 await page.locator('.gr-cover').click({position:{x:5,y:5}});assert.equal(await dialog.count(),0);assert.equal(await panel.getByLabel('第 1 行提示词',{exact:true}).inputValue(),'风格一');assert.equal(await panel.locator('.gr-multiplier').innerText(),'×5');
 assert.equal(await page.evaluate(()=>fixtureApp.graph.getNodeById(1).properties.group_runner_prompts.length),5);
 await panel.getByRole('button',{name:'保存当前工作流绑定',exact:true}).click();await page.waitForFunction(()=>!GroupRunnerUI.saving&&GroupRunnerUI.bindingId);const binding=await page.evaluate(()=>GroupRunnerUI.bindingId);
 await panel.getByRole('button',{name:'运行第 1 行',exact:true}).click();await page.waitForFunction(()=>GroupRunnerUI.runner.jobs.at(-1)?.state==='done',{}, {timeout:15000});
 let stats=await(await fetch(host+'/tests/stats')).json();assert.deepEqual(stats.records.map(record=>record.prompt['1'].inputs.text),['风格一','风格二','风格三','风格四','风格五']);assert.equal(stats.submitted,5);
 await panel.getByLabel('第 1 行运行次数',{exact:true}).fill('2');await panel.getByLabel('第 1 行运行次数',{exact:true}).press('Tab');
 await panel.getByRole('button',{name:'运行第 1 行',exact:true}).click();await page.waitForFunction(()=>GroupRunnerUI.runner.jobs.at(-1)?.state==='running');
 assert.equal(await panel.getByLabel('第 1 行提示词',{exact:true}).isEnabled(),true,'running leaves text editing enabled');
 // Add a sixth style while the first of ten runs is already submitted.
 await panel.getByLabel('第 1 行提示词',{exact:true}).dblclick();await dialog.getByRole('button',{name:'添加提示词文本框',exact:true}).click();await dialog.getByLabel('批量提示词 7',{exact:true}).fill('运行中追加');await dialog.getByRole('button',{name:'关闭批量提示词',exact:true}).click();
 await page.waitForFunction(()=>GroupRunnerUI.runner.jobs.at(-1)?.state==='done',{}, {timeout:20000});stats=await(await fetch(host+'/tests/stats')).json();assert.deepEqual(stats.records.slice(5).map(record=>record.prompt['1'].inputs.text),['风格一','风格一','风格二','风格二','风格三','风格三','风格四','风格四','风格五','风格五','运行中追加','运行中追加']);
 // Editing while graph serialization is awaiting cannot rewrite that run.
 await panel.getByLabel('第 1 行运行次数',{exact:true}).fill('1');await panel.getByLabel('第 1 行运行次数',{exact:true}).press('Tab');
 await page.evaluate(()=>{globalThis.serializeGate=new Promise(resolve=>globalThis.releaseGate=resolve);});await panel.getByRole('button',{name:'运行第 1 行',exact:true}).click();await panel.getByLabel('第 1 行提示词',{exact:true}).fill('稍后编辑的首条');await page.evaluate(()=>{releaseGate();serializeGate=null;});await page.waitForFunction(()=>!!GroupRunnerUI.runner.current?.prompt_id);
 const frozenId=await page.evaluate(()=>GroupRunnerUI.runner.current.prompt_id);let frozenRecord;
 for(let attempt=0;attempt<100;attempt++){const fresh=await(await fetch(host+'/tests/stats?t='+Date.now())).json();frozenRecord=fresh.records.find(record=>record.id===frozenId);if(frozenRecord)break;await new Promise(resolve=>setTimeout(resolve,50));}
 await panel.getByRole('button',{name:'取消第 1 行',exact:true}).click();await page.waitForFunction(()=>!GroupRunnerUI.runner.busy);
 assert.ok(frozenRecord);assert.equal(frozenRecord.prompt['1'].inputs.text,'风格一','the serialized request uses its captured prompt');
 await page.reload();await page.waitForFunction(()=>globalThis.ready);await page.evaluate(()=>GroupRunnerUI.ready);assert.equal(await page.evaluate(()=>GroupRunnerUI.bindingId),binding);assert.equal(await panel.locator('.gr-multiplier').innerText(),'×5');
 assert.deepEqual(errors,[]);await panel.screenshot({path:path.join(shots,'variants-panel.png')});await page.evaluate(()=>GroupRunnerUI.destroy());
 console.log('VARIANTS UI PASS: five styles/blank skipping, modal outside close, multiplier, node drafts, bindings reload, repeated styles, append while running, request isolation and cancellation.');
}finally{if(browser)await browser.close();server.stdin.end('\n');if(server.exitCode===null)await new Promise(resolve=>server.once('exit',resolve));}})().catch(error=>{console.error(error,diagnostics);process.exitCode=1;});
