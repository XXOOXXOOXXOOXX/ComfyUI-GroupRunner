import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";
import { GroupPanel } from "./panel.js";
app.registerExtension({name:"GroupRunner.FloatingPanel",async setup(){
    if(globalThis.GroupRunnerUI?.root?.isConnected)return;
    if(!document.getElementById("group-runner-style")){const css=document.createElement("link");css.id="group-runner-style";css.rel="stylesheet";css.href=new URL("./style.css?v=1.2.1",import.meta.url).href;document.head.append(css);}
    globalThis.GroupRunnerUI=new GroupPanel({app,api});await GroupRunnerUI.ready;
}});
