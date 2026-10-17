import {members,rowPrompts} from "./model.js";

const TYPES=new Set(["EagleAssetExport","EagleVideoExport","EagleAudioExport","EagleModelExport"]);
export const exportNodes=(graph,group)=>group?members(graph,group).filter(node=>TYPES.has(node.comfyClass||node.type)):[];
const widget=(node,name)=>node.widgets?.find(item=>item.name===name);
export function exportState(node){
    const raw=widget(node,"settings")?.value;
    try{const value=typeof raw==="string"?JSON.parse(raw):raw;if(value&&typeof value==="object"&&!Array.isArray(value))return value;}catch{}
    return node.eagleAssetsEditor?.state||{};
}
export function eagleConfig(row,nodes){
    if(!row.eagle&&nodes.length){
        const state=exportState(nodes[0]);
        row.eagle={folder_id:state.folder_id||"",folder_label:state.folder_label||"",library_key:state.library_key||null,save_eagle:!!state.save_eagle,save_output:!!state.save_output,filename_prefix:String(widget(nodes[0],"filename_prefix")?.value??"ComfyUI"),annotation:false,tags:false};
    }
    return row.eagle;
}
export function connectionKey(node){const state=exportState(node);return JSON.stringify([state.host||"http://localhost:41595",state.token||""]);}
export function sameConnection(nodes){return new Set(nodes.map(connectionKey)).size<=1;}
function writeWidget(node,name,value){const target=widget(node,name);if(target){target.value=value;if(target.inputEl)target.inputEl.value=value;}}
function mergedState(node,config){
    return {...exportState(node),folder_id:config.folder_id,folder_label:config.folder_label,library_key:config.library_key,save_eagle:config.save_eagle,save_output:config.save_output};
}
export function syncExportNodes(graph,group,row){
    if(!row.eagle)return;
    for(const node of exportNodes(graph,group)){
        const raw=JSON.stringify(mergedState(node,row.eagle));
        writeWidget(node,"settings",raw);writeWidget(node,"filename_prefix",row.eagle.filename_prefix);
        node.eagleAssetsEditor?.restore?.(raw);node.setDirtyCanvas?.(true,true);
    }
    graph.change?.();
}
function chineseNumber(value){
    const digits="零一二三四五六七八九";
    if(value<10)return digits[value];
    if(value<100)return(value<20?"":digits[Math.floor(value/10)])+"十"+(value%10?digits[value%10]:"");
    if(value<1000)return digits[Math.floor(value/100)]+"百"+(value%100?(value%100<10?"零":"")+chineseNumber(value%100):"");
    return String(value);
}
export function promptAnnotation(row){return rowPrompts(row).map((entry,index)=>(index?`第${chineseNumber(index+1)}文本框内容\n`:"")+entry.prompt).join("\n\n");}
export function promptTags(row){return JSON.stringify([...new Set(rowPrompts(row).flatMap(entry=>entry.prompt.split(/[,，;；\r\n]+/)).map(value=>value.trim()).filter(Boolean))]);}
export function applyExportInputs(output,graph,group,row){
    if(!row.eagle)return;
    const ids=new Set(exportNodes(graph,group).map(node=>String(node.id)));
    for(const [id,node]of Object.entries(output)){
        if(!ids.has(id)||!TYPES.has(node.class_type))continue;
        // Override linked metadata only for this run, without changing canvas links.
        const base=typeof node.inputs.settings==="string"?JSON.parse(node.inputs.settings):exportState(graph.getNodeById(id));
        const state={...base,folder_id:row.eagle.folder_id,folder_label:row.eagle.folder_label,library_key:row.eagle.library_key,save_eagle:row.eagle.save_eagle,save_output:row.eagle.save_output};
        if(row.eagle.annotation){state.annotation=promptAnnotation(row);node.inputs.annotation=state.annotation;}
        if(row.eagle.tags){state.tags=promptTags(row);node.inputs.tags=state.tags;}
        node.inputs.settings=JSON.stringify(state);node.inputs.filename_prefix=row.eagle.filename_prefix;
    }
}
