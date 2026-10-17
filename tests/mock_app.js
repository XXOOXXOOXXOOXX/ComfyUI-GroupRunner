const graphs=new Map();
function makeGraph(name){
 const nodes=[
  {id:1,type:'GroupRunnerText',title:'音色提示词',outputs:[{type:'STRING'}],widgets:[{name:'text',value:name+' first prompt'}]},
  {id:2,type:'TestGenerate',title:'生成节点',outputs:[{type:'STRING'}],widgets:[{name:'seed',value:10}]},
  {id:3,type:'GroupRunnerText',title:'画面提示词',outputs:[{type:'STRING'}],widgets:[{name:'text',value:name+' second prompt'}]},
  {id:4,type:'TestOutput',title:'输出节点',outputs:[],widgets:[]},
  {id:5,type:'TestOutput',title:'无关输出',outputs:[],widgets:[]}
 ];
 nodes[1].widgets[0].afterQueued=()=>nodes[1].widgets[0].value++;
 const graph={id:'graph-'+name,extra:{},_nodes:nodes,getNodeById(id){return nodes.find(node=>String(node.id)===String(id))},change(){this.changes=(this.changes||0)+1}};
 for(const node of nodes){node.graph=graph;node.pos=[50*node.id,50];node.size=[200,100];node.setDirtyCanvas=()=>{}}
 graph._groups=[{id:10,title:'自定义音色',color:'#7487a2',_bounding:[0,0,800,300],nodes:nodes.slice(0,2)},{id:11,title:'图片生成',color:'#947a9a',_bounding:[0,330,800,300],nodes:nodes.slice(2,4)},{id:12,title:'仅用途标记',_bounding:[0,700,800,100],nodes:[]}];
 for(let index=0;index<(globalThis.fixtureExtraTexts||0);index++)addTextNode(graph,6+index);
 if(globalThis.fixtureEagle)for(const [index,type]of ['EagleAssetExport','EagleVideoExport','EagleAudioExport','EagleModelExport'].entries()){
  const node={id:20+index,type,title:type,graph,outputs:[],inputs:[{name:'annotation',link:55},{name:'tags',link:56}],pos:[50,80],size:[550,500],widgets:[{name:'settings',value:JSON.stringify({version:1,host:'http://localhost:41595',token:'fixture-secret',folder_id:'',save_eagle:false,save_output:false,annotation:'manual annotation',tags:'manual tags',custom:'preserved'})},{name:'filename_prefix',value:'original/'+index}],setDirtyCanvas(){}};
  nodes.push(node);graph._groups[0].nodes.push(node);
 }
 return graph;
}
function addTextNode(graph,id){const node={id,type:'GroupRunnerText',title:'附加提示词 '+id,outputs:[{type:'STRING'}],widgets:[{name:'text',value:'native text '+id}],graph,pos:[50,80],size:[200,100],setDirtyCanvas(){}};graph._nodes.push(node);graph._groups[0].nodes.push(node);return node;}
globalThis.addFixtureText=id=>addTextNode(app.graph,id);
export const app={extensions:[],registerExtension(extension){this.extensions.push(extension)},extensionManager:{workflow:{activeWorkflow:null}},canvas:{ds:{offset:[0,0],scale:.7,getViewportSize:()=>[innerWidth,innerHeight]},setDirty(){this.redraws=(this.redraws||0)+1}},graph:null,
 async graphToPrompt(graph=this.graph){
  if(globalThis.serializeGate)await globalThis.serializeGate;
  const output={
   '1':{class_type:'GroupRunnerText',inputs:{text:graph.getNodeById(1).widgets[0].value}},
   '2':{class_type:'TestGenerate',inputs:{text:['1',0],seed:graph.getNodeById(2).widgets[0].value}},
   '3':{class_type:'GroupRunnerText',inputs:{text:graph.getNodeById(3).widgets[0].value}},
   '4':{class_type:'TestOutput',inputs:{text:['3',0]}},
   '5':{class_type:'TestOutput',inputs:{text:'MUST NOT RUN'}}
  };
  for(const node of graph._nodes)if(node.type==='GroupRunnerText'&&!output[node.id])output[node.id]={class_type:'GroupRunnerText',inputs:{text:node.widgets[0].value}};
  for(const node of graph._nodes)if(node.type.startsWith('Eagle')&&node.type.endsWith('Export'))output[node.id]={class_type:node.type,inputs:{settings:node.widgets[0].value,filename_prefix:node.widgets[1].value,annotation:['3',0],tags:['3',0],media:['2',0]}};
  return{workflow:{version:.4,id:graph.id,nodes:graph._nodes.map(node=>({id:node.id,type:node.type,widgets_values:node.widgets.map(widget=>widget.value)})),extra:structuredClone(graph.extra)},output};
 }};
globalThis.switchWorkflow=name=>{if(!graphs.has(name))graphs.set(name,makeGraph(name));app.graph=app.rootGraph=graphs.get(name);app.extensionManager.workflow.activeWorkflow={name:'同名工作流',path:name+'/workflow.json'};};
switchWorkflow('A');globalThis.fixtureApp=app;
