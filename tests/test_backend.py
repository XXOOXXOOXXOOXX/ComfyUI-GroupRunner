import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import types
import unittest

ROOT=Path(__file__).parents[1]


def load(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);sys.modules[name]=module;spec.loader.exec_module(module);return module


class BackendTests(unittest.TestCase):
    def test_prompt_variants_binding_roundtrip_and_validation(self):
        storage=load("group_runner_variants_storage_test",ROOT/"storage.py")
        config={"version":4,"workflow":{"identity":"path:styles.json","name":"styles"},"rows":[{"id":"a"*32,"group":{"id":1},"count":1,"prompts":[{"text_node_id":"1","prompt":"北欧","variants":["北欧","","中古","现代"]}]}]}
        with tempfile.TemporaryDirectory() as directory:
            store=storage.BindingStore(directory);store.write("b"*32,config);self.assertEqual(store.read()["b"*32]["rows"],config["rows"])
        for variants in [[],"text",[None],["x"*50001],[""]*1001]:
            broken=json.loads(json.dumps(config));broken["rows"][0]["prompts"][0]["variants"]=variants
            with self.assertRaises(ValueError):storage.validate_config(broken)

    def test_text_and_runtime_target_preserve_values(self):
        nodes=load("group_runner_nodes_test",ROOT/"nodes.py")
        self.assertEqual(nodes.GroupRunnerText().text("中文\nexact prompt"),("中文\nexact prompt",))
        value=object();self.assertEqual(nodes.GroupRunnerTarget().consume(value),{})
        self.assertFalse(nodes.AnyType("*")!="IMAGE")

    def test_binding_roundtrip_atomic_delete_and_validation(self):
        storage=load("group_runner_storage_test",ROOT/"storage.py")
        with tempfile.TemporaryDirectory() as directory:
            store=storage.BindingStore(directory);key="a"*32
            config={"version":1,"workflow":{"identity":"path:甲.json","name":"甲"},"rows":[{"id":"b"*32,"group":{"id":2,"title":"group"},"text_node_id":"1","prompt":"多行\n提示词","count":10}]}
            store.write(key,config);self.assertEqual(store.read()[key]["rows"],config["rows"])
            store.write("c"*32,config);store.write(key);self.assertNotIn(key,store.read());self.assertIn("c"*32,store.read())
            self.assertEqual(list(Path(directory).glob("*.tmp")),[])
            for invalid in [0,True,1001,-1]:
                broken=json.loads(json.dumps(config));broken["rows"][0]["count"]=invalid
                with self.assertRaises(ValueError):store.write(key,broken)
            with self.assertRaises(ValueError):store.write("../escape",config)

    def test_multiple_prompt_binding_and_duplicate_validation(self):
        storage=load("group_runner_multi_storage_test",ROOT/"storage.py")
        config={"version":2,"workflow":{"identity":"path:multi.json","name":"multi"},"rows":[{"id":"d"*32,"group":{"id":1},"count":2,"prompts":[{"text_node_id":"1","prompt":"人物\n角色"},{"text_node_id":"2","prompt":"声音"}]}]}
        with tempfile.TemporaryDirectory() as directory:
            store=storage.BindingStore(directory);store.write("a"*32,config)
            self.assertEqual(store.read()["a"*32]["rows"][0]["prompts"],config["rows"][0]["prompts"])
        for invalid in [None,{},[{"text_node_id":True,"prompt":"x"}],[{"text_node_id":"1","prompt":"x"},{"text_node_id":1,"prompt":"y"}],[{"text_node_id":"1","prompt":"x"*50001}]]:
            broken=json.loads(json.dumps(config));broken["rows"][0]["prompts"]=invalid
            with self.assertRaises(ValueError):storage.validate_config(broken)

    def test_eagle_controls_roundtrip_and_reject_invalid_fields(self):
        storage=load("group_runner_eagle_storage_test",ROOT/"storage.py")
        config={"version":3,"workflow":{"identity":"path:eagle.json","name":"eagle"},"rows":[{"id":"d"*32,"group":{"id":1},"count":1,"prompts":[],"eagle":{"folder_id":"f1","folder_label":"角色","library_key":"library","filename_prefix":"images/角色","save_eagle":True,"save_output":False,"annotation":True,"tags":True}}]}
        with tempfile.TemporaryDirectory() as directory:
            store=storage.BindingStore(directory);store.write("a"*32,config);self.assertEqual(store.read()["a"*32]["rows"],config["rows"])
        for field,value in [("save_eagle",1),("filename_prefix",[]),("library_key",False),("token","secret")]:
            broken=json.loads(json.dumps(config));broken["rows"][0]["eagle"][field]=value
            with self.assertRaises(ValueError):storage.validate_config(broken)

    def test_cancel_matches_session_and_job_and_never_interrupts_foreign_work(self):
        # Load the actual routes module with a minimal ComfyUI host.
        package=types.ModuleType("gr_test");package.__path__=[str(ROOT)];sys.modules["gr_test"]=package
        sys.modules["folder_paths"]=types.SimpleNamespace(get_user_directory=lambda:"unused")
        sys.modules["server"]=types.SimpleNamespace(PromptServer=types.SimpleNamespace(instance=None))
        import importlib
        routes=importlib.import_module("gr_test.routes")
        session="a"*32;job="b"*32;other="c"*32
        def item(pid,owner=session,job_id=job):return (0,pid,{}, {"extra_pnginfo":{"workflow":{"extra":{"group_runner_run":{"session":owner,"job":job_id}}}}},[])
        class Queue:
            def __init__(self):self.mutex=threading.RLock();self.pending=[item("own-pending"),item("foreign-session",other),item("foreign-row",session,other)];self.currently_running={"running":item("foreign-running",other)}
            def delete_queue_item(self,predicate):
                for index,value in enumerate(self.pending):
                    if predicate(value):self.pending.pop(index);return True
                return False
        queue=Queue();interrupted=[]
        result=routes.cancel_jobs(queue,session,[job],lambda:interrupted.append(True))
        self.assertEqual(result,{"removed":1,"interrupted":False});self.assertFalse(interrupted)
        self.assertEqual([item[1] for item in queue.pending],["foreign-session","foreign-row"])
        queue.currently_running={"own":item("own-running")}
        self.assertTrue(routes.cancel_jobs(queue,session,[job],lambda:interrupted.append(True))["interrupted"])
        self.assertEqual(len(interrupted),1)


if __name__=="__main__":unittest.main()
