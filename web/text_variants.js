// Drafts remain on the canvas. The queue overrides only its serialized STRING
// input, so typing while a run is being submitted never changes that run.
export function syncTextNode(node, values) {
    values = values.filter(value => typeof value === "string" && value.trim());
    if (!values.length) values = [""];
    node.properties ||= {}; node.properties.group_runner_prompts = [...values];
    const primary = node.widgets?.find(widget => widget.name === "text");
    if (primary) {
        const previous=node.groupRunnerSyncing;node.groupRunnerSyncing=true;
        try{if(primary.value!==values[0])primary.value=values[0];if(primary.inputEl&&primary.inputEl.value!==values[0])primary.inputEl.value=values[0];}
        finally{node.groupRunnerSyncing=previous;}
    }
    if (!node.addDOMWidget || (!node.groupRunnerVariants && values.length===1)) return;
    if (!node.groupRunnerVariants) {
        const root = document.createElement("div");
        root.style.cssText = "display:flex;flex-direction:column;gap:5px;padding:5px;box-sizing:border-box;width:100%;overflow:auto;color:var(--input-text,#ddd);font:12px system-ui";
        for (const name of ["pointerdown","keydown","wheel"]) root.addEventListener(name,event=>event.stopPropagation());
        const editor = node.groupRunnerVariants = {root,fields:[]};
        const height = () => editor.fields.length ? editor.fields.length * 68 + 10 : 0;
        const widget = node.addDOMWidget("group_runner_variants","group_runner_variants",root,{serialize:false,hideOnZoom:false,getMinHeight:height,getHeight:height});
        widget.options ||= {}; widget.options.serialize = false;
    }
    const editor = node.groupRunnerVariants, count = values.length - 1;
    while (editor.fields.length > count) editor.fields.pop().wrap.remove();
    while (editor.fields.length < count) {
        const index=editor.fields.length+1, wrap=document.createElement("label"), field=document.createElement("textarea");
        wrap.textContent=`提示词 ${index+1}`; wrap.style.cssText="display:flex;flex-direction:column;gap:2px;flex:none";
        field.ariaLabel=`批量提示词 ${index+1}`; field.rows=2;field.maxLength=50000;
        field.style.cssText="box-sizing:border-box;width:100%;height:44px;min-height:36px;resize:vertical;background:var(--comfy-input-bg,#222);color:inherit;border:1px solid #66718b;border-radius:5px;padding:4px;font:inherit";
        field.addEventListener("input",()=>{
            const drafts=[...node.properties.group_runner_prompts];drafts[index]=field.value;node.properties.group_runner_prompts=drafts;
            node.graph?.change?.(); dispatchEvent(new CustomEvent("group-runner-text-drafts",{detail:{node,values:drafts}}));
        });
        wrap.append(field);editor.root.append(wrap);editor.fields.push({wrap,field});
    }
    editor.fields.forEach(({field},index)=>{if(field.value!==values[index+1])field.value=values[index+1];});
    if(editor.count!==count){editor.count=count;const size=node.computeSize?.();if(size)node.setSize?.([Math.max(node.size[0],size[0]),Math.max(node.size[1],size[1])]);}
    node.setDirtyCanvas?.(true,true);
}

export function installTextVariants(node) {
    const primary=node.widgets?.find(widget=>widget.name==="text");
    if(primary){const callback=primary.callback;primary.callback=function(value){const result=callback?.apply(this,arguments);if(node.groupRunnerSyncing)return result;const values=[...(node.properties?.group_runner_prompts||[""])];values[0]=typeof value==="string"?value:String(primary.value??"");node.properties||={};node.properties.group_runner_prompts=values;dispatchEvent(new CustomEvent("group-runner-text-drafts",{detail:{node,values}}));return result;};}
    const configure=node.onConfigure;
    node.onConfigure=function(){const result=configure?.apply(this,arguments);syncTextNode(this,this.properties?.group_runner_prompts||[String(primary?.value||"")]);return result;};
}
