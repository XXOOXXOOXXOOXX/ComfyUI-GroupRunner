import test from 'node:test';
import assert from 'node:assert/strict';
import {GroupQueue} from '../web/runner.js';

test('reorder pending rows while preserving current, foreign and finished jobs',()=>{
    const graph={},foreign={},info={graph,identity:'A'},queue=Object.create(GroupQueue.prototype);
    const job=(id,state='queued',owner=graph,identity='A')=>({row:{id},state,graph:owner,identity});
    const current=job('b','running'),a=job('a'),c=job('c','paused'),other=job('foreign','queued',foreign,'B'),done=job('done','done'),sameIdOtherGraph=job('a','queued',foreign);
    queue.current=current;queue.jobs=[done,current,a,other,c,sameIdOtherGraph];
    queue.reorderRows([{id:'c'},{id:'b'},{id:'a'}],info);
    assert.deepEqual(queue.jobs,[done,current,c,other,a,sameIdOtherGraph]);
    assert.equal(current.state,'running');assert.equal(c.state,'paused');
    queue.reorderRows([{id:'c'},{id:'b'},{id:'a'}],info);
    assert.deepEqual(queue.jobs,[done,current,c,other,a,sameIdOtherGraph]);
});
