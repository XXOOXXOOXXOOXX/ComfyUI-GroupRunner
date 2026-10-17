import test from 'node:test';import assert from 'node:assert/strict';
import {centerGroup} from '../web/navigation.js';
test('native canvas centers the live group bounds and preserves zoom',()=>{
 const group={_bounding:new Float32Array([1200,-600,800,300])},canvas={ds:{scale:.6},centerOnNode(target){this.target=target;}};
 centerGroup(canvas,group);assert.deepEqual(canvas.target,{pos:[1200,-600],size:[800,300]});assert.equal(canvas.ds.scale,.6);
 group._bounding[0]=2400;centerGroup(canvas,group);assert.equal(canvas.target.pos[0],2400);
});
test('fallback centers precisely at the existing scale including high DPI canvases',()=>{
 const canvas={dpr:2,canvas:{width:2000,height:1200},ds:{offset:new Float32Array([8,9]),scale:.5},setDirty(foreground,background){this.redrawn=foreground&&background;}};
 const group={pos:[1200,-600],size:[800,300]};centerGroup(canvas,group);
 assert.equal((1600+canvas.ds.offset[0])*canvas.ds.scale,500);assert.equal((-450+canvas.ds.offset[1])*canvas.ds.scale,300);assert.equal(canvas.ds.scale,.5);assert.equal(canvas.redrawn,true);
});
test('invalid bounds or unready canvas do not corrupt the viewport',()=>{
 const canvas={ds:{offset:[10,20],scale:1}};
 assert.throws(()=>centerGroup(canvas,{_bounding:[0,NaN,100,100]}));assert.throws(()=>centerGroup(canvas,{_bounding:[0,0,100,100]}));assert.deepEqual(canvas.ds.offset,[10,20]);
});
