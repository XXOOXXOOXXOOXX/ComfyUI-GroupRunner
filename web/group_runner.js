import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { GroupPanel } from "./panel.js";
import { installTextVariants } from "./text_variants.js";
app.registerExtension({name:"GroupRunner.FloatingPanel",beforeRegisterNodeDef(nodeType,nodeData){
    if(nodeData.name!=="GroupRunnerText")return;
    const created=nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated=function(){const result=created?.apply(this,arguments);installTextVariants(this);return result;};
},async setup(){
    if(globalThis.GroupRunnerUI?.root?.isConnected)return;
    if(!document.getElementById("group-runner-style")){const css=document.createElement("link");css.id="group-runner-style";css.rel="stylesheet";css.href=new URL("./style.css?v=1.4.0",import.meta.url).href;document.head.append(css);}
    globalThis.GroupRunnerUI=new GroupPanel({app,api});await GroupRunnerUI.ready;
}});
