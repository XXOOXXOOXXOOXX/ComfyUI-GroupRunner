import { uid, resolveGroup, buildPlan, graphNodes, workflowInfo, textNodes, rowPrompts } from "./model.js";
import {syncExportNodes,applyExportInputs,exportNodes,sameConnection} from "./eagle.js";
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
export class GroupQueue {
    constructor({app,api,request,onChange=()=>{},isActive=()=>true}) {
        Object.assign(this,{app,api,request,onChange,isActive}); this.session=uid(); this.jobs=[]; this.current=null; this.paused=false;
    }
    get busy() { return this.jobs.some(job=>["queued","running","paused","submitting","cancelling"].includes(job.state)); }
    jobFor(row) { return [...this.jobs].reverse().find(job=>job.row.id===row && !["done","cancelled","error"].includes(job.state)); }
    enqueue(rows, info) {
        const selected=rows.filter(row=>!this.jobFor(row.id));
        for(const row of rows) {
            if(!resolveGroup(info.graph,row.group))throw new Error("请先为每一行选择有效分组。");
            if(!Number.isInteger(row.count)||row.count<1||row.count>1000)throw new Error("每行次数必须为 1–1000。");
            if(row.eagle?.save_eagle&&exportNodes(info.graph,resolveGroup(info.graph,row.group)).length&&!row.eagle.folder_id)throw new Error("保存到 Eagle 已开启，请先选择 Eagle 目录。");
        }
        for(const row of selected)this.jobs.push({id:uid(),row:structuredClone(row),graph:info.graph,identity:info.identity,state:"queued",done:0,message:"等待执行",cancelled:false});
        const wanted=new Set(rows.map(row=>row.id));for(const job of this.jobs)if(wanted.has(job.row.id)&&job.identity===info.identity){job.suspended=false;if(job.state==="paused"){job.state="queued";job.message="等待继续";}}
        this.paused=false;
        this.onChange(); this.pump();
    }
    pause(message="已暂停后续批次") {
        this.paused=true;
        for(const job of this.jobs)if(["queued","running","submitting"].includes(job.state)){job.suspended=true;if(job.state==="queued"){job.state="paused";job.message=message;}}
        this.onChange();
    }
    async cancel(rowId) {
        const job=this.jobFor(rowId);if(!job)return;
        job.cancelled=true;job.state="cancelling";job.message="正在取消…";this.onChange();
        try { await this.request("/cancel",{session:this.session,jobs:[job.id]});job.state="cancelled";job.message="已取消"; }
        catch(error){job.state="error";job.message="后续批次已停；取消当前任务失败："+error.message;}
        this.onChange();
    }
    async submit(job) {
        const info=workflowInfo(this.app);
        if(info.graph!==job.graph||info.identity!==job.identity||!this.isActive()){job.suspended=true;return null;}
        const group=resolveGroup(job.graph,job.row.group);if(!group)throw new Error("分组已删除或无法匹配，请重新选择。");
        const prompts=rowPrompts(job.row),available=new Map(textNodes(job.graph,group).map(node=>[String(node.id),node]));
        if(prompts.some(entry=>!available.has(String(entry.text_node_id))))throw new Error("所选文本节点已不在这个分组，请刷新后重新运行。");
        for(const entry of prompts) {
            const chosen=available.get(String(entry.text_node_id)),widget=chosen.widgets?.find(widget=>widget.name==="text");
            if(widget){widget.value=entry.prompt;if(widget.inputEl)widget.inputEl.value=entry.prompt;}
        }
        if(job.row.eagle?.save_eagle&&!sameConnection(exportNodes(job.graph,group)))throw new Error("同组 Eagle 导出节点的连接不同，请先统一 Eagle 地址和 Token。");
        syncExportNodes(job.graph,group,job.row);
        let data=await this.app.graphToPrompt(job.graph);
        if(job.cancelled)return null;
        const serializedInfo=workflowInfo(this.app);
        if(serializedInfo.graph!==job.graph||serializedInfo.identity!==job.identity||this.paused||job.suspended||!this.isActive()){job.suspended=true;return null;}
        applyExportInputs(data.output,job.graph,group,job.row);
        let plan=buildPlan(data.output,job.graph,group,this.nodeDefs);
        const nodes=graphNodes(job.graph).filter(node=>plan.nodeIds.includes(String(node.id)));
        for(const node of nodes)for(const widget of node.widgets||[])widget.beforeQueued?.({isPartialExecution:true});
        // Native seed controls may update a widget in beforeQueued.
        data=await this.app.graphToPrompt(job.graph);applyExportInputs(data.output,job.graph,group,job.row);plan=buildPlan(data.output,job.graph,group,this.nodeDefs);
        const now=workflowInfo(this.app);
        if(job.cancelled)return null;
        if(now.graph!==job.graph||now.identity!==job.identity||this.paused||job.suspended||!this.isActive()){job.suspended=true;return null;}
        applyExportInputs(plan.output,job.graph,group,job.row);
        const workflow=structuredClone(data.workflow);workflow.extra||={};workflow.extra.group_runner_run={session:this.session,job:job.id,row:job.row.id};
        job.state="submitting";job.message=`提交 ${job.done+1} / ${job.row.count}`;this.onChange();
        const response=await this.api.queuePrompt(0,{output:plan.output,workflow},{partialExecutionTargets:plan.targets});
        if(!response?.prompt_id)throw new Error("ComfyUI 没有返回任务编号。");
        job.prompt_id=response.prompt_id;
        for(const node of nodes)for(const widget of node.widgets||[])try{widget.afterQueued?.();}catch(error){console.warn("[GroupRunner] afterQueued",error);}
        if(job.cancelled)await this.request("/cancel",{session:this.session,jobs:[job.id]});
        return response.prompt_id;
    }
    async completion(job,id) {
        let absent=0;
        while(!job.cancelled) {
            await delay(650);
            const history=await this.api.fetchApi("/history/"+encodeURIComponent(id));if(!history.ok)throw new Error("无法读取执行历史，已停止继续提交。");
            const value=(await history.json())[id];
            if(value) {
                const status=value.status;
                if(status?.status_str==="error" || status?.messages?.some(event=>["execution_error","execution_interrupted"].includes(event[0])))throw new Error("本行执行失败或被中断，请查看 ComfyUI 错误详情。");
                return;
            }
            const response=await this.api.fetchApi("/queue");if(!response.ok)throw new Error("无法读取队列，已停止继续提交。");
            const queue=await response.json();
            const present=[...(queue.queue_running||[]),...(queue.queue_pending||[])].some(item=>item[1]===id);
            if(!present&&++absent>=4)throw new Error("任务已从队列移除，后续批次已停止。");
            if(present)absent=0;
        }
    }
    async pump() {
        if(this.pumping)return;this.pumping=true;
        try {
            while(!this.paused&&this.isActive()) {
                const job=this.jobs.find(job=>job.state==="queued");if(!job)break;this.current=job;
                try {
                    while(job.done<job.row.count&&!job.cancelled&&!job.suspended&&!this.paused&&this.isActive()) {
                        const id=await this.submit(job);if(!id)break;
                        job.state="running";job.message=`执行 ${job.done+1} / ${job.row.count}`;this.onChange();
                        await this.completion(job,id);if(!job.cancelled)job.done++;this.onChange();
                    }
                    if(!job.cancelled){job.state=job.done===job.row.count?"done":"paused";job.message=job.state==="done"?"已完成":"已暂停后续批次";}
                }catch(error){if(!job.cancelled){job.state="error";job.message=error.message;}}
                this.current=null;this.onChange();
            }
        }finally{this.pumping=false;}
    }
}
