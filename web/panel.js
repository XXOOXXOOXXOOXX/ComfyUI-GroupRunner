import {blankRow,uid,workflowInfo,graphGroups,groupRef,resolveGroup,textNodes,members,syncPrompts} from "./model.js";
import {GroupQueue} from "./runner.js";
import {centerGroup} from "./navigation.js";
import {exportNodes,exportState,eagleConfig,connectionKey,sameConnection,syncExportNodes} from "./eagle.js";
const PREFS="group-runner.panel.v1";
const el=(tag,cls="",text="")=>{const node=document.createElement(tag);node.className=cls;node.textContent=text;return node;};
const button=(label,text,callback,cls="")=>{const node=el("button",cls,text);node.type="button";node.ariaLabel=node.title=label;node.addEventListener("click",callback);return node;};
const iconButton=(label,paths,callback)=>{
    const control=button(label,"",callback,"gr-icon"),ns="http://www.w3.org/2000/svg",svg=document.createElementNS(ns,"svg");
    svg.setAttribute("viewBox","0 0 24 24");svg.setAttribute("aria-hidden","true");
    for(const d of paths){const path=document.createElementNS(ns,"path");path.setAttribute("d",d);svg.append(path);}control.append(svg);return control;
};
export class GroupPanel {
    constructor({app,api}) {
        Object.assign(this,{app,api});this.bindings={};this.drafts=new Map();this.folderCache=new Map();this.rows=[blankRow()];this.elements=new Map();this.saving=false;this.initializing=true;
        this.prefs={x:24,y:70,minimized:false,showName:true};try{Object.assign(this.prefs,JSON.parse(localStorage.getItem(PREFS)||"{}"));}catch{}
        this.root=el("div","gr-host");this.panel=el("section","gr-panel");this.panel.setAttribute("role","region");this.panel.ariaLabel="框运行管理";
        this.header=el("header","gr-header");const headerLeft=el("div","gr-header-left");headerLeft.append(el("strong","gr-title","框运行"));
        const countLabel=el("label","gr-count","控制数量");this.count=el("input");this.count.type="number";this.count.min=1;this.count.max=64;this.count.value=1;this.count.ariaLabel="控制数量";countLabel.append(this.count);headerLeft.append(countLabel);
        this.name=button("显示或隐藏工作流名称","工作流",()=>{this.prefs.showName=!this.prefs.showName;this.savePrefs();this.updateHeading();},"gr-name");
        this.saveButton=iconButton("保存当前工作流绑定",["M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2Z","M7 3v6h10V3M7 21v-8h10v8"],()=>this.save());
        this.deleteButton=iconButton("删除当前工作流绑定",["M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"],()=>this.remove());
        const actions=el("div","gr-header-actions");actions.append(this.saveButton,this.deleteButton,iconButton("刷新分组及工作流绑定",["M20 7v5h-5M4 17v-5h5","M6.1 6a8 8 0 0 1 13 2L20 12M4 12l.9 4a8 8 0 0 0 13 2"],()=>this.refresh()),this.runAll=button("按行整体运行","整体运行",()=>this.startAll(),"gr-primary"),button("最小化并暂停框运行","−",()=>this.minimize(),"gr-minimize"));
        this.header.append(headerLeft,this.name,actions);
        this.list=el("div","gr-rows");this.status=el("div","gr-status","正在读取设置…");this.status.setAttribute("role","status");
        this.panel.append(this.header,this.list,this.status);this.pill=button("恢复框运行管理","框运行",event=>{const dragged=this.pillDragged;this.pillDragged=false;if(!dragged||event.detail===0)this.restore();},"gr-pill");this.root.append(this.panel,this.pill);document.body.append(this.root);
        for(const type of ["pointerdown","keydown","wheel"])this.root.addEventListener(type,event=>event.stopPropagation());
        this.count.addEventListener("change",()=>{if(!this.ensureCurrent())return;const size=Math.max(1,Math.min(64,Math.round(Number(this.count.value)||1)));while(this.rows.length<size)this.rows.push(blankRow());this.rows=this.rows.slice(0,size);this.dirty=true;this.render();});
        this.runner=new GroupQueue({app,api,request:(path,body)=>this.request(path,"POST",body),onChange:()=>this.updateJobs(),isActive:()=>!this.prefs.minimized&&!this.destroyed});
        this.drag();this.dragPill();this.onResize=()=>{this.layout();this.layoutPill();this.fitPrompts();};addEventListener("resize",this.onResize);this.layout();this.setView();
        this.ready=this.initialize();this.timer=setInterval(()=>{if(!this.prefs.minimized&&!this.initializing)this.syncWorkflow();},450);
    }
    async request(path,method="GET",body) {
        const response=await this.api.fetchApi("/group_runner"+path,{method,headers:{"Content-Type":"application/json"},...(body?{body:JSON.stringify(body)}:{})});
        const value=await response.json();if(!response.ok||!value.ok)throw new Error(value.error||"框运行请求失败");return value;
    }
    async initialize(){try{const results=await Promise.all([this.request("/bindings"),this.api.getNodeDefs?this.api.getNodeDefs():this.api.fetchApi("/object_info").then(response=>response.json())]);this.bindings=results[0].bindings;this.storagePath=results[0].path;this.runner.nodeDefs=results[1];this.initializing=false;this.syncWorkflow(true);}catch(error){this.initializing=false;this.notice(error.message,true);}return this;}
    savePrefs(){try{localStorage.setItem(PREFS,JSON.stringify(this.prefs));}catch{}}
    notice(text,error=false){this.status.textContent=text;this.status.dataset.error=String(error);}
    info(){return workflowInfo(this.app);}
    ensureCurrent(){const info=this.info();if(this.graph!==info.graph||this.key!==info.identity+"|"+(info.binding||"")){this.syncWorkflow();this.notice("工作流已切换，配置已刷新，请再次操作");return false;}return true;}
    syncWorkflow(force=false){
        const info=this.info();if(!info.graph)return;
        const key=info.identity+"|"+(info.binding||"");
        if(!force&&key===this.key&&info.graph===this.graph){if(this.structureSignature!==this.structure())this.render();return;}
        if(this.key){this.drafts.set(this.key,{rows:structuredClone(this.rows),dirty:this.dirty});this.runner.pause("工作流已切换，等待手动继续");}
        this.closeModal();this.key=key;this.graph=info.graph;this.active=info.active;
        const entries=Object.entries(this.bindings),matched=entries.filter(([,binding])=>binding.workflow.identity===info.identity).sort((a,b)=>b[1].updated_at-a[1].updated_at)[0];
        const inherited=!matched&&info.binding?this.bindings[info.binding]:null;
        this.bindingId=matched?.[0]||null;
        const draft=this.drafts.get(key);this.rows=structuredClone(draft?.rows||matched?.[1].rows||inherited?.rows||[blankRow()]);this.dirty=draft?.dirty||false;
        this.render();this.notice(this.bindingId?"已匹配保存的工作流配置":inherited?"已读取工作流携带的配置 · 点击保存建立独立绑定":"未绑定 · 设置完成后点击保存");
    }
    updateHeading(){const info=this.info();this.name.textContent=this.prefs.showName?info.name:"显示工作流名称";this.name.title=info.name;this.name.setAttribute("aria-pressed",String(this.prefs.showName));this.name.dataset.bound=String(!!this.bindingId);}
    structure(){return JSON.stringify(this.rows.map(row=>{const group=resolveGroup(this.graph,row.group);return group?[group.title,members(this.graph,group).map(node=>[String(node.id),node.title,node.comfyClass||node.type])]:null;}));}
    fitPrompt(prompt){prompt.style.height="28px";prompt.style.height=Math.min(118,Math.max(28,prompt.scrollHeight+2))+"px";}
    fitPrompts(){for(const {prompts}of this.elements.values())for(const {prompt}of prompts)this.fitPrompt(prompt);}
    async save(){
        if(this.saving||!this.ensureCurrent())return;const info=this.info(),key=this.key;this.saving=true;this.updateJobs();
        try{
            const id=this.bindingId||uid();const payload={version:3,workflow:{identity:info.identity,name:info.name},rows:this.rows};
            const value=await this.request("/bindings/"+id,"PUT",payload);this.bindings[id]=value.binding;
            if(this.key!==key||this.info().identity!==info.identity)throw new Error("配置已保存，但工作流已切换，未修改当前工作流。");
            info.graph.extra||={};info.graph.extra.group_runner_binding=id;info.graph.change?.();this.bindingId=id;this.dirty=false;
            this.key=info.identity+"|"+id;this.drafts.set(this.key,{rows:structuredClone(this.rows),dirty:false});this.updateHeading();this.notice("绑定已保存 · 保存工作流文件可一并携带绑定标识");
        }catch(error){this.notice(error.message,true);}finally{this.saving=false;this.updateJobs();}
    }
    async remove(){if(!this.ensureCurrent()||!this.bindingId)return;const id=this.bindingId,key=this.key;try{await this.request("/bindings/"+id,"DELETE");delete this.bindings[id];if(this.key!==key)return;delete this.graph.extra?.group_runner_binding;this.graph.change?.();this.bindingId=null;this.dirty=true;this.key=this.info().identity+"|";this.updateHeading();this.notice("已删除绑定，工作流节点与分组保持原样");this.updateJobs();}catch(error){this.notice(error.message,true);}}
    async refresh(){if(!this.runner.nodeDefs)return this.initialize();try{const data=await this.request("/bindings");this.bindings=data.bindings;this.folderCache.clear();this.syncWorkflow();this.render();this.notice("已刷新工作流与分组，当前未保存的编辑已保留");}catch(error){this.notice(error.message,true);}}
    eagleControls(row,group,index){
        const root=el("div","gr-export-controls"),nodes=exportNodes(this.graph,group),config=eagleConfig(row,nodes),inputs=[],context=this.key;
        const connected=nodes.length>0,shared=sameConnection(nodes),set=(field,value)=>{
            if(!this.ensureCurrent()||this.runner.jobFor(row.id)||!config)return false;
            config[field]=value;this.dirty=true;syncExportNodes(this.graph,group,row);return true;
        };
        const folder=el("select","gr-eagle-folder");folder.ariaLabel=`第 ${index+1} 行 Eagle 目录`;folder.title=shared?"选择同组 Eagle 导出节点的目标目录":"同组导出节点需要使用相同的 Eagle 地址和 Token";
        const populate=cache=>{
            folder.replaceChildren();const mismatch=!!(config?.library_key&&cache?.library_key&&config.library_key!==cache.library_key);
            const add=(value,text)=>{const option=el("option","",text);option.value=value;folder.append(option);};
            add("",!connected?"没有 Eagle 导出节点":mismatch?"素材库已变化，请重新选择":cache?.loading?"读取 Eagle 目录…":cache?.error?"读取失败，点击刷新重试":"请选择 Eagle 目录");
            if(cache?.folders){add("__ALL__","整个素材库（根目录）");for(const item of cache.folders)add(item.id,item.path||item.name||item.id);}
            if(config?.folder_id&&!mismatch){if(![...folder.options].some(option=>option.value===config.folder_id))add(config.folder_id,(config.folder_label||"已保存目录")+"（待读取）");folder.value=config.folder_id;}
        };
        const load=async()=>{
            if(!connected||!shared)return;const source=nodes[0],key=connectionKey(source);let cache=this.folderCache.get(key);
            if(!cache){cache={loading:true};this.folderCache.set(key,cache);cache.promise=(async()=>{
                try{const response=await this.api.fetchApi("/eagle_assets/connect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({settings:JSON.stringify(exportState(source))})});const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.error||"请检查 EagleAssets 插件及 Eagle 连接");Object.assign(cache,{folders:result.folders,library_key:result.library_key});}
                catch(error){cache.error=error.message;if(this.key===context&&!this.destroyed)this.notice("Eagle 目录读取失败："+error.message,true);}finally{cache.loading=false;}
            })();}
            populate(cache);await cache.promise;
            if(this.key===context&&folder.isConnected&&connectionKey(source)===key)populate(cache);
        };
        folder.addEventListener("focus",load);folder.addEventListener("pointerdown",load);
        folder.addEventListener("change",()=>{if(!this.ensureCurrent()||!config)return;const cache=this.folderCache.get(connectionKey(nodes[0]));config.folder_label=folder.selectedOptions[0]?.textContent||"";config.library_key=cache?.library_key||config.library_key;if(set("folder_id",folder.value))populate(cache);});
        const toggle=(field,text,label)=>{
            const control=button(`第 ${index+1} 行${label}`,text,()=>{if(set(field,!config[field]))paint();},"gr-export-toggle");
            const paint=()=>{control.dataset.on=String(!!config?.[field]);control.setAttribute("aria-pressed",String(!!config?.[field]));};paint();inputs.push({control,available:connected&&(field!=="save_eagle"||shared)});return control;
        };
        const eagle=toggle("save_eagle","存 Eagle","保存到 Eagle"),prefix=el("input","gr-export-prefix");prefix.ariaLabel=`第 ${index+1} 行 output 文件名前缀`;prefix.title="output 内的相对路径及文件名前缀（filename_prefix）";prefix.placeholder="output 路径 / 文件名前缀";prefix.value=config?.filename_prefix||"";prefix.maxLength=2000;prefix.addEventListener("input",()=>set("filename_prefix",prefix.value));
        const output=toggle("save_output","存 output","保存到 output"),annotation=toggle("annotation","注释","提示词写入注释"),tags=toggle("tags","标签","提示词写入标签");
        annotation.title="开启后将全部提示词合并写入 Eagle 注释；第二段起标注文本框序号";tags.title="开启后合并全部提示词，按逗号或换行拆分为 Eagle 标签";
        const jump=iconButton(`第 ${index+1} 行跳转分组`,["M4 12h16M13 5l7 7-7 7"],()=>this.jumpToGroup(row));jump.classList.add("gr-jump");jump.title="跳转到此分组并居中显示";
        inputs.push({control:folder,available:connected&&shared},{control:prefix,available:connected},{control:jump,available:!!group,navigation:true});root.append(folder,eagle,prefix,output,annotation,tags,jump);populate();
        // Start after render has attached the select; stale workflow responses cannot update it.
        if(connected&&shared)queueMicrotask(load);
        return{root,inputs};
    }
    render(){this.count.value=this.rows.length;this.list.replaceChildren();this.elements.clear();this.updateHeading();
        for(const [index,row]of this.rows.entries()){
            const group=resolveGroup(this.graph,row.group);const line=el("article","gr-row");line.dataset.rowId=row.id;
            const groupButton=button(`第 ${index+1} 行选择分组`,group?.title||row.group?.title||"双击选择分组",()=>{},"gr-group");groupButton.title="双击选择当前工作流中的分组";groupButton.dataset.missing=String(!!row.group&&!group);
            groupButton.addEventListener("dblclick",()=>this.chooseGroup(row));groupButton.addEventListener("keydown",event=>{if(event.key==="Enter")this.chooseGroup(row);});
            const groupCell=el("div","gr-group-cell");groupCell.append(groupButton);const nodeCount=el("small","gr-node-count",group?`${members(this.graph,group).length} 个节点`:row.group?"分组已移除":"未选择");
            const eagle=this.eagleControls(row,group,index);
            const promptCell=el("div","gr-prompt-stack"),nodes=group?textNodes(this.graph,group):[],entries=group?syncPrompts(row,nodes):[],prompts=[];
            for(const [promptIndex,entry]of (entries.length?entries:[null]).entries()){
                const promptLine=el("div","gr-prompt-line"),node=entry?nodes.find(node=>String(node.id)===entry.text_node_id):null;
                const name=node?`${node.title||"通用文本"} · #${node.id}`:"不控制文本节点";let select=null;
                if(nodes.length>1){
                    select=el("select");select.ariaLabel=promptIndex===0?`第 ${index+1} 行文本节点`:`第 ${index+1} 行第 ${promptIndex+1} 个文本节点`;
                    for(const candidate of nodes){const option=el("option","",`${candidate.title||"通用文本"} · #${candidate.id}`);option.value=String(candidate.id);select.append(option);}select.value=entry.text_node_id;
                    select.addEventListener("change",()=>{if(!this.ensureCurrent())return;const other=entries.findIndex(candidate=>candidate.text_node_id===select.value);if(other<0)return;[entries[promptIndex],entries[other]]=[entries[other],entries[promptIndex]];this.dirty=true;this.render();});
                    promptLine.append(select);
                }else{const label=el("span","gr-text-name",name);label.title=name;promptLine.append(label);}
                const prompt=el("textarea");prompt.ariaLabel=promptIndex===0?`第 ${index+1} 行提示词`:`第 ${index+1} 行第 ${promptIndex+1} 个提示词`;prompt.placeholder=node?"在这里填写提示词":"组内添加「框运行 · 通用文本」即可输入";prompt.value=entry?.prompt||"";prompt.maxLength=50000;prompt.rows=1;prompt.disabled=!node;
                prompt.addEventListener("input",()=>{if(!this.ensureCurrent()||!entry)return;entry.prompt=prompt.value;this.fitPrompt(prompt);this.dirty=true;const widget=node?.widgets?.find(widget=>widget.name==="text");if(widget){widget.value=entry.prompt;if(widget.inputEl)widget.inputEl.value=entry.prompt;this.graph.change?.();node.setDirtyCanvas?.(true,true);}});
                promptLine.append(prompt);promptCell.append(promptLine);prompts.push({prompt,select,hasText:!!node});
            }
            const count=el("input","gr-batch");count.type="number";count.min=1;count.max=1000;count.value=row.count;count.ariaLabel=`第 ${index+1} 行运行次数`;count.addEventListener("change",()=>{row.count=Math.max(1,Math.min(1000,Math.round(Number(count.value)||1)));count.value=row.count;this.dirty=true;});
            const run=button(`运行第 ${index+1} 行`,"运行",()=>this.start(row),"gr-run"),cancel=button(`取消第 ${index+1} 行`,"取消",()=>this.runner.cancel(row.id),"gr-cancel");
            const progress=el("div","gr-progress","待命");progress.setAttribute("role","status");const main=el("div","gr-row-main");main.append(groupCell,eagle.root,nodeCount,count,run,cancel);line.append(main,promptCell,progress);this.list.append(line);this.elements.set(row.id,{line,groupButton,prompts,eagle:eagle.inputs,count,run,cancel,progress});
        }this.structureSignature=this.structure();this.updateJobs();this.layout();this.fitPrompts();
    }
    updateJobs(){if(!this.runner)return;const busy=this.rows.some(row=>this.runner.jobFor(row.id));this.count.disabled=busy;this.saveButton.disabled=this.saving;this.deleteButton.disabled=!this.bindingId||busy||this.saving;this.runAll.disabled=this.prefs.minimized;
        this.runAll.textContent=this.runner.paused&&busy?"继续全部":"整体运行";
        for(const row of this.rows){const controls=this.elements.get(row.id);if(!controls)continue;const job=this.runner.jobFor(row.id),last=[...this.runner.jobs].reverse().find(job=>job.row.id===row.id);const blocked=!!job;
            controls.groupButton.disabled=blocked;for(const {prompt,select,hasText}of controls.prompts){prompt.disabled=blocked||!hasText;if(select)select.disabled=blocked;}for(const {control,available,navigation}of controls.eagle)control.disabled=(!navigation&&blocked)||!available;controls.count.disabled=blocked;controls.cancel.disabled=!job;controls.run.disabled=blocked&&job.state!=="paused";controls.run.textContent=job?.state==="paused"?"继续":"运行";
            controls.progress.textContent=last?`${last.message} · ${last.done} / ${last.row.count}`:"待命";controls.progress.dataset.state=last?.state||"idle";
        }
    }
    start(row){try{if(!this.ensureCurrent())return;if(!this.runner.nodeDefs)throw new Error("尚未读取节点定义，请点击刷新。");this.runner.enqueue([row],this.info());}catch(error){this.notice(error.message,true);}}
    startAll(){try{if(!this.ensureCurrent())return;if(!this.runner.nodeDefs)throw new Error("尚未读取节点定义，请点击刷新。");this.runner.enqueue(this.rows,this.info());}catch(error){this.notice(error.message,true);}}
    jumpToGroup(row){try{if(!this.ensureCurrent())return;const group=resolveGroup(this.graph,row.group);if(!group){this.render();throw new Error("分组已移除，请重新选择。");}const canvas=this.app.canvas;if(canvas?.graph&&canvas.graph!==this.graph)throw new Error("请先返回当前工作流的主画布，再定位分组。");centerGroup(canvas,group);this.notice(`已定位分组：${group.title||"未命名分组"}`);}catch(error){this.notice(error.message,true);}}
    chooseGroup(row){if(!this.ensureCurrent()||this.runner.jobFor(row.id))return;const groups=[...graphGroups(this.graph)];const {body}=this.modal("选择工作流分组");const search=el("input");search.placeholder="搜索分组名称";search.ariaLabel="搜索分组";const list=el("div","gr-group-list");const draw=()=>{list.replaceChildren();for(const [index,group]of groups.entries()){if(!String(group.title||"").toLowerCase().includes(search.value.toLowerCase()))continue;const choose=button(`选择分组 ${index+1} ${group.title}`,`${group.title||"未命名分组"} · ${members(this.graph,group).length} 个节点`,()=>{if(!this.ensureCurrent())return;row.group=groupRef(this.graph,group);row.prompts=[];delete row.text_node_id;delete row.prompt;delete row.eagle;this.dirty=true;this.closeModal();this.render();},"gr-group-option");choose.style.borderLeftColor=group.color||"#597d9a";list.append(choose);}if(!list.children.length)list.append(el("div","gr-note","没有匹配的分组，请先在画布中用 Ctrl + G 创建分组。"));};search.addEventListener("input",draw);body.append(search,list);draw();search.focus();}
    modal(title){this.closeModal();const cover=el("div","gr-cover"),dialog=el("section","gr-dialog");dialog.setAttribute("role","dialog");dialog.ariaLabel=title;dialog.setAttribute("aria-modal","true");const header=el("header");header.append(el("strong","",title),button("关闭选择分组","×",()=>this.closeModal()));const body=el("div","gr-dialog-body");dialog.append(header,body);cover.append(dialog);this.root.append(cover);this.modalCover=cover;cover.addEventListener("click",event=>{if(event.target===cover)this.closeModal();});cover.addEventListener("keydown",event=>{if(event.key==="Escape")this.closeModal();});return{body};}
    closeModal(){this.modalCover?.remove();this.modalCover=null;}
    setView(){this.panel.hidden=!!this.prefs.minimized;this.pill.hidden=!this.prefs.minimized;if(this.prefs.minimized)this.layoutPill();}
    layoutPill(){const width=this.pill.offsetWidth||70,height=this.pill.offsetHeight||30;const x=Number.isFinite(this.prefs.pillX)?this.prefs.pillX:22,y=Number.isFinite(this.prefs.pillY)?this.prefs.pillY:innerHeight-height-22;this.prefs.pillX=Math.max(4,Math.min(x,innerWidth-width-4));this.prefs.pillY=Math.max(4,Math.min(y,innerHeight-height-4));Object.assign(this.pill.style,{left:this.prefs.pillX+"px",top:this.prefs.pillY+"px",bottom:"auto"});}
    dragPill(){this.pill.addEventListener("pointerdown",event=>{if(event.button!==0)return;this.pillDragged=false;const start={x:event.clientX,y:event.clientY,left:this.prefs.pillX,top:this.prefs.pillY};this.pill.setPointerCapture(event.pointerId);const move=current=>{if(Math.hypot(current.clientX-start.x,current.clientY-start.y)>4)this.pillDragged=true;if(!this.pillDragged)return;this.prefs.pillX=start.left+current.clientX-start.x;this.prefs.pillY=start.top+current.clientY-start.y;this.layoutPill();};const end=()=>{this.pill.removeEventListener("pointermove",move);this.pill.removeEventListener("pointerup",end);this.pill.removeEventListener("pointercancel",end);this.savePrefs();};this.pill.addEventListener("pointermove",move);this.pill.addEventListener("pointerup",end);this.pill.addEventListener("pointercancel",end);});}
    minimize(){this.runner.pause("浮窗已最小化，等待手动继续");this.prefs.minimized=true;this.closeModal();this.savePrefs();this.setView();}
    restore(){this.prefs.minimized=false;this.savePrefs();this.setView();this.syncWorkflow();this.render();this.notice("已恢复 · 暂停的批次需点击继续");}
    layout(){const width=Math.max(320,Math.min(1200,innerWidth-24));this.prefs.x=Math.max(8,Math.min(Number(this.prefs.x)||8,innerWidth-width-8));this.prefs.y=Math.max(8,Math.min(Number(this.prefs.y)||8,innerHeight-80));Object.assign(this.panel.style,{width:width+"px",left:this.prefs.x+"px",top:this.prefs.y+"px",maxHeight:Math.max(100,innerHeight-this.prefs.y-10)+"px"});}
    drag(){this.header.addEventListener("pointerdown",event=>{if(event.button!==0||event.target.closest("button,input,label"))return;event.preventDefault();const start={x:event.clientX,y:event.clientY,left:this.prefs.x,top:this.prefs.y};this.header.setPointerCapture(event.pointerId);const move=current=>{this.prefs.x=start.left+current.clientX-start.x;this.prefs.y=start.top+current.clientY-start.y;this.layout();};const end=()=>{this.header.removeEventListener("pointermove",move);this.header.removeEventListener("pointerup",end);this.header.removeEventListener("pointercancel",end);this.savePrefs();};this.header.addEventListener("pointermove",move);this.header.addEventListener("pointerup",end);this.header.addEventListener("pointercancel",end);});}
    destroy(){this.destroyed=true;this.runner.pause("面板已关闭");clearInterval(this.timer);removeEventListener("resize",this.onResize);this.closeModal();this.root.remove();}
}

