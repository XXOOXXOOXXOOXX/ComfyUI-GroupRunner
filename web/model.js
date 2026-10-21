export const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,"0")).join("");
export const blankRow = () => ({ id: uid(), group: null, prompts: [], count: 1 });
export const graphNodes = graph => graph?._nodes || [];
export const graphGroups = graph => graph?._groups || graph?.groups || [];
export function members(graph, group) {
    group.recomputeInsideNodes?.();
    const nodes = group.nodes || group._nodes;
    if (nodes && typeof nodes[Symbol.iterator] === "function") {
        const listed=[...nodes].map(node => typeof node === "object" ? (graph.getNodeById ? graph.getNodeById(node.id) : node) : graph.getNodeById(node)).filter(Boolean);
        if(listed.length)return listed;
    }
    const [x,y,w,h] = group._bounding || [...group.pos, ...group.size];
    return graphNodes(graph).filter(node => node.pos?.length>=2 && node.size?.length>=2 && node.pos[0] < x+w && node.pos[1] < y+h && node.pos[0]+node.size[0] > x && node.pos[1]+node.size[1] > y);
}
export function groupRef(graph, group) {
    return { id: group.id ?? null, title: group.title || "未命名分组", members: members(graph,group).map(node=>String(node.id)).sort(), rect: [...(group._bounding || [...group.pos,...group.size])] };
}
export function resolveGroup(graph, ref) {
    if (!ref) return null;
    const groups = [...graphGroups(graph)];
    if (ref.id != null && ref.id !== -1) { const found = groups.find(group => group.id === ref.id); if (found) return found; }
    const signature = JSON.stringify(ref.members || []), same = groups.filter(group => JSON.stringify(members(graph,group).map(node=>String(node.id)).sort()) === signature);
    if (same.length === 1 && ref.members?.length) return same[0];
    const titles = groups.filter(group => group.title === ref.title);
    return titles.length === 1 ? titles[0] : null;
}
export function textNodes(graph, group) { return members(graph,group).filter(node => (node.comfyClass || node.type) === "GroupRunnerText"); }
export function rowPrompts(row) {
    return Array.isArray(row.prompts) ? row.prompts : row.text_node_id == null ? [] : [{text_node_id:String(row.text_node_id),prompt:row.prompt||""}];
}
export function promptDrafts(entry) { return Array.isArray(entry?.variants) ? entry.variants : [entry?.prompt || ""]; }
export function promptValues(entry) { return promptDrafts(entry).filter(value => typeof value === "string" && value.trim()); }
export function rowVariantCount(row) { return Math.max(1,...rowPrompts(row).map(entry => promptValues(entry).length)); }
export function variantRow(row, index) {
    return {...row, prompts:rowPrompts(row).map(entry=>{
        const values=promptValues(entry);
        return {text_node_id:entry.text_node_id,prompt:values[Math.min(index,values.length-1)] || ""};
    })};
}
export function syncPrompts(row, nodes) {
    // Keep each node's own draft when nodes are added, removed, or reordered.
    // Legacy single-text bindings migrate without losing their saved prompt.
    const available=new Map(nodes.map(node=>[String(node.id),node])),seen=new Set();
    const prompts=rowPrompts(row).filter(entry=>available.has(String(entry.text_node_id))&&!seen.has(String(entry.text_node_id))&&seen.add(String(entry.text_node_id))).map(entry=>({...entry,text_node_id:String(entry.text_node_id)}));
    for(const [id,node]of available)if(!seen.has(id)){
        const variants=node.properties?.group_runner_prompts;
        prompts.push({text_node_id:id,prompt:String(node.widgets?.find(widget=>widget.name==="text")?.value??""),...(Array.isArray(variants)&&variants.length>1?{variants:[...variants]}:{})});
    }
    row.prompts=prompts;
    delete row.text_node_id;delete row.prompt;
    return prompts;
}
export function hash(value) {
    let result = 2166136261; for (const letter of value) result = Math.imul(result ^ letter.charCodeAt(0),16777619); return (result>>>0).toString(16);
}
export function workflowInfo(app) {
    const graph = app.rootGraph || app.graph;
    const active = app.extensionManager?.workflow?.activeWorkflow || app.workflowManager?.activeWorkflow || app.ui?.workflows?.activeWorkflow;
    const path = active?.path || active?.filename;
    const name = active?.name || path || graph?.extra?.workflow_name || "未命名工作流";
    const signature = hash(JSON.stringify(graphNodes(graph).map(node=>[String(node.id),node.comfyClass||node.type]).sort()));
    return { graph, active, name: String(name), identity: path ? "path:"+path : graph?.id ? "id:"+graph.id : "graph:"+signature,
        binding: graph?.extra?.group_runner_binding || null };
}
function dependencyIds(output, targets) {
    const keep = new Set(), visit = id => {
        id = String(id); if (keep.has(id) || !output[id]) return;
        keep.add(id);
        for (const value of Object.values(output[id].inputs || {})) if (Array.isArray(value) && value.length === 2 && typeof value[1] === "number" && output[String(value[0])]) visit(value[0]);
    };
    targets.forEach(visit); return keep;
}
export function buildPlan(output, graph, group, nodeDefs = {}) {
    const ids = new Set(members(graph,group).map(node=>String(node.id)));
    const inside = Object.keys(output).filter(id => ids.has(id) || [...ids].some(parent=>id.startsWith(parent+":")));
    if (!inside.length) throw new Error("这个分组没有可执行节点，请检查静音、旁路或空分组。");
    const insideSet = new Set(inside), consumed = new Set();
    for (const id of inside) for (const value of Object.values(output[id].inputs || {})) if (Array.isArray(value) && value.length === 2 && insideSet.has(String(value[0]))) consumed.add(String(value[0]));
    const terminals = inside.filter(id=>!consumed.has(id) || nodeDefs[output[id].class_type]?.output_node);
    const keep = dependencyIds(output, terminals), filtered = Object.fromEntries([...keep].map(id=>[id,structuredClone(output[id])]));
    const targets = [];
    for (const id of terminals) {
        const def = nodeDefs[output[id].class_type];
        const nativeNode = graph.getNodeById?.(id);
        if (def?.output_node || (!def?.output?.length && !(nativeNode?.outputs?.length))) targets.push(id);
        else {
            const key = "gr_target_"+id;
            if (output[key]) throw new Error("执行终点 ID 冲突，请检查工作流。");
            filtered[key] = { class_type:"GroupRunnerTarget", inputs:{value:[id,0]}, _meta:{title:"框运行临时执行终点"} }; targets.push(key);
        }
    }
    if (!targets.length) throw new Error("分组没有可运行的终点。");
    return { output: filtered, targets, nodeIds: [...keep] };
}
