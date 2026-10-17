"""Actual plugin HTTP routes with a deterministic local ComfyUI execution double."""
import asyncio
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import uuid

ROOT=Path(__file__).parents[1]
sys.path.insert(0,str(ROOT.parent/".test-deps"))
from aiohttp import web


class Queue:
    def __init__(self):
        self.mutex=threading.RLock();self.queue=[];self.currently_running={};self.history={};self.records=[];self.interrupted=set();self.counter=0
    def delete_queue_item(self,predicate):
        with self.mutex:
            for index,item in enumerate(self.queue):
                if predicate(item):self.queue.pop(index);return True
        return False
    def interrupt(self):
        with self.mutex:
            self.interrupted.update(item[1] for item in self.currently_running.values())


async def main():
    with tempfile.TemporaryDirectory(prefix="group-runner-test-") as directory:
        routes=web.RouteTableDef();queue=Queue()
        sys.modules["folder_paths"]=types.SimpleNamespace(get_user_directory=lambda:directory)
        sys.modules["server"]=types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=types.SimpleNamespace(routes=routes,prompt_queue=queue)))
        sys.modules["nodes"]=types.SimpleNamespace(interrupt_processing=queue.interrupt)
        spec=importlib.util.spec_from_file_location("group_runner_fixture",ROOT/"__init__.py",submodule_search_locations=[str(ROOT)])
        module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module)
        app=web.Application(client_max_size=6_000_000);app.add_routes(routes)
        async def worker():
            while True:
                await asyncio.sleep(.03)
                with queue.mutex:
                    if not queue.queue:continue
                    item=queue.queue.pop(0);pid=item[1];queue.currently_running[pid]=item
                await asyncio.sleep(.35)
                cancelled=pid in queue.interrupted;cache={}
                def execute(node_id):
                    if node_id in cache:return cache[node_id]
                    node=item[2][node_id];inputs={key:execute(str(value[0])) if isinstance(value,list) and len(value)==2 and str(value[0]) in item[2] else value for key,value in node["inputs"].items()}
                    kind=node["class_type"]
                    if kind=="GroupRunnerText":result=module.NODE_CLASS_MAPPINGS[kind]().text(**inputs)[0]
                    elif kind=="GroupRunnerTarget":module.NODE_CLASS_MAPPINGS[kind]().consume(**inputs);result=None
                    elif kind=="TestGenerate":result=inputs["text"]+" seed="+str(inputs["seed"])
                    elif kind=="TestOutput":result=inputs["text"]
                    elif kind in {"EagleAssetExport","EagleVideoExport","EagleAudioExport","EagleModelExport"}:result={"settings":json.loads(inputs["settings"]),"filename_prefix":inputs["filename_prefix"],"annotation":inputs.get("annotation"),"tags":inputs.get("tags")}
                    else:raise ValueError(kind)
                    cache[node_id]=result;return result
                if not cancelled:
                    for node_id,node in item[2].items():
                        if node["class_type"] in {"GroupRunnerTarget","TestOutput","EagleAssetExport","EagleVideoExport","EagleAudioExport","EagleModelExport"}:execute(node_id)
                queue.records.append({"id":pid,"prompt":item[2],"workflow":item[3]["extra_pnginfo"]["workflow"],"values":cache,"cancelled":cancelled})
                with queue.mutex:
                    queue.currently_running.pop(pid,None);queue.history[pid]={"status":{"status_str":"error" if cancelled else "success","completed":True,"messages":[["execution_interrupted",{}]] if cancelled else []}}
        task=asyncio.create_task(worker())
        async def prompt(request):
            body=await request.json();pid=str(uuid.uuid4());queue.counter+=1
            with queue.mutex:queue.queue.append((queue.counter,pid,body["prompt"],body["extra_data"],body.get("partial_execution_targets",[])))
            return web.json_response({"prompt_id":pid,"node_errors":{}})
        async def history(request):
            pid=request.match_info["id"];return web.json_response({pid:queue.history[pid]} if pid in queue.history else {})
        async def get_queue(request):
            return web.json_response({"queue_running":list(queue.currently_running.values()),"queue_pending":list(queue.queue)})
        app.router.add_post("/prompt",prompt);app.router.add_get("/history/{id}",history);app.router.add_get("/queue",get_queue)
        async def stats(request):return web.json_response({"records":queue.records,"submitted":queue.counter,"interrupted":list(queue.interrupted)})
        app.router.add_get("/tests/stats",stats)
        async def eagle_connect(request):
            body=await request.json();settings=json.loads(body["settings"])
            if settings.get("token")!="fixture-secret":return web.json_response({"ok":False,"error":"invalid test connection"},status=400)
            return web.json_response({"ok":True,"library_key":"test-library","library_name":"测试素材库","folders":[{"id":"f1","path":"作品 / 角色"},{"id":"f2","path":"作品 / 场景"}]})
        app.router.add_post("/eagle_assets/connect",eagle_connect)
        async def eagle_static(request):
            eagle_root=(ROOT.parent/"ComfyUI-EagleAssets").resolve();path=(eagle_root/request.match_info["file"]).resolve()
            if not path.is_relative_to(eagle_root) or not path.is_file():raise web.HTTPNotFound()
            return web.FileResponse(path,headers={"Content-Type":"application/javascript" if path.suffix in {".js",".mjs"} else "text/css"})
        app.router.add_get("/eagle_plugin/{file:.*}",eagle_static)
        async def static(request):
            path=(ROOT/request.match_info["file"]).resolve()
            if not path.is_relative_to(ROOT) or not path.is_file():raise web.HTTPNotFound()
            return web.FileResponse(path,headers={"Content-Type":"application/javascript" if path.suffix in {".js",".mjs"} else "text/css" if path.suffix==".css" else "text/html"})
        app.router.add_get("/plugin/{file:.*}",static)
        async def script(request):
            name=request.match_info["file"]
            if name=="app.js":source=(ROOT/"tests/mock_app.js").read_text(encoding="utf-8")
            elif name=="api.js":source="""export const api={clientId:'fixture-client',apiURL:path=>path,fetchApi:(path,options)=>fetch(path,options),async getNodeDefs(){return (await fetch('/object_info')).json()},async queuePrompt(number,data,options){const response=await fetch('/prompt',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:data.output,partial_execution_targets:options?.partialExecutionTargets,extra_data:{extra_pnginfo:{workflow:data.workflow}}})});if(!response.ok)throw new Error('queue error');return response.json()}};"""
            else:raise web.HTTPNotFound()
            return web.Response(text=source,content_type="application/javascript")
        app.router.add_get("/scripts/{file}",script)
        async def definitions(request):return web.json_response({"GroupRunnerText":{"output":["STRING"]},"TestGenerate":{"output":["STRING"]},"TestOutput":{"output":[],"output_node":True},"GroupRunnerTarget":{"output":[],"output_node":True},**{kind:{"output":[],"output_node":True} for kind in ("EagleAssetExport","EagleVideoExport","EagleAudioExport","EagleModelExport")}})
        app.router.add_get("/object_info",definitions)
        runner=web.AppRunner(app);await runner.setup();site=web.TCPSite(runner,"127.0.0.1",0);await site.start()
        print(json.dumps({"host":"http://127.0.0.1:"+str(site._server.sockets[0].getsockname()[1])}),flush=True)
        try:await asyncio.to_thread(sys.stdin.readline)
        finally:task.cancel();await runner.cleanup()


if __name__=="__main__":asyncio.run(main())
