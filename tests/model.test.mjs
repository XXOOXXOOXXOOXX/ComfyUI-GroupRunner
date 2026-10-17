import test from 'node:test';import assert from 'node:assert/strict';
import {buildPlan,groupRef,resolveGroup,workflowInfo,syncPrompts,rowPrompts} from '../web/model.js';
function fixture(){
 const nodes=[{id:1,type:'GroupRunnerText',outputs:[{type:'STRING'}]},{id:2,type:'Echo',outputs:[{type:'STRING'}]},{id:3,type:'Save',outputs:[]},{id:4,type:'Save',outputs:[]}];
 const group={id:10,title:'A',_bounding:[0,0,100,100],nodes:[nodes[1],nodes[2]]};const graph={_nodes:nodes,_groups:[group],getNodeById:id=>nodes.find(node=>String(node.id)===String(id))};
 const output={'1':{class_type:'GroupRunnerText',inputs:{text:'x'}},'2':{class_type:'Echo',inputs:{text:['1',0]}},'3':{class_type:'Save',inputs:{text:['2',0]}},'4':{class_type:'Save',inputs:{text:'unrelated'}}};return{nodes,group,graph,output};
}
test('group execution keeps needed upstream dependencies and excludes unrelated output branches',()=>{
 const {graph,group,output}=fixture();const plan=buildPlan(output,graph,group,{Echo:{output:['STRING']},Save:{output_node:true,output:[]}});
 assert.deepEqual(new Set(Object.keys(plan.output)),new Set(['1','2','3']));assert.deepEqual(plan.targets,['3']);assert.equal(output['4'].inputs.text,'unrelated');
});
test('non-output terminal gets an execution-only sink without mutating workflow nodes',()=>{
 const {graph,group,output}=fixture();group.nodes=[graph.getNodeById(2)];const plan=buildPlan(output,graph,group,{Echo:{output:['STRING']}});
 assert.deepEqual(plan.targets,['gr_target_2']);assert.deepEqual(plan.output.gr_target_2.inputs.value,['2',0]);assert.equal(graph._nodes.length,4);assert.equal(Object.keys(output).length,4);
});
test('group IDs survive rename and legacy duplicate titles resolve by membership',()=>{
 const {graph,group,nodes}=fixture();const ref=groupRef(graph,group);group.title='new name';assert.equal(resolveGroup(graph,ref),group);
 delete group.id;ref.id=null;graph._groups.push({title:'A',nodes:[nodes[3]],_bounding:[0,0,2,2]});assert.equal(resolveGroup(graph,ref),group);
 group.nodes=[];group.title='removed';assert.equal(resolveGroup(graph,{...ref,title:'unknown'}),null);
});
test('same-name workflows in different folders have separate bindings',()=>{
 const {graph}=fixture();const app={graph,extensionManager:{workflow:{activeWorkflow:{name:'same',path:'one/same.json'}}}};const first=workflowInfo(app);app.extensionManager.workflow.activeWorkflow.path='two/same.json';assert.notEqual(first.identity,workflowInfo(app).identity);
});
test('legacy prompt migrates and multiple text drafts survive additions and reordering',()=>{
 const node=id=>({id,widgets:[{name:'text',value:'native '+id}]}),one=node(1),two=node(2),three=node(3);
 const row={text_node_id:2,prompt:'saved second'};
 assert.deepEqual(syncPrompts(row,[one,two]),[{text_node_id:'2',prompt:'saved second'},{text_node_id:'1',prompt:'native 1'}]);
 row.prompts[1].prompt='edited first';syncPrompts(row,[three,two,one]);
 assert.deepEqual(rowPrompts(row).map(entry=>entry.prompt),['saved second','edited first','native 3']);
 syncPrompts(row,[one,three]);assert.deepEqual(row.prompts.map(entry=>entry.text_node_id),['1','3']);
 assert.equal(row.prompts[0].prompt,'edited first');assert.equal(row.prompt,undefined);
});
