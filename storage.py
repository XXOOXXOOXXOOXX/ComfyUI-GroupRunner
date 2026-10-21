import json
from pathlib import Path
import re
import threading
import time
import uuid

_lock = threading.RLock()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{32}", value):
        raise ValueError("绑定或任务 ID 无效。")
    return value


def validate_config(data):
    if not isinstance(data, dict) or data.get("version") not in (1, 2, 3, 4):
        raise ValueError("配置格式无效。")
    workflow = data.get("workflow", {})
    if not isinstance(workflow, dict) or any(not isinstance(workflow.get(key), str) or len(workflow[key]) > 2000 for key in ("identity", "name")):
        raise ValueError("工作流标识无效。")
    rows = data.get("rows")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 64:
        raise ValueError("控制数量必须为 1–64。")
    seen = set()
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("控制行格式无效。")
        row_id = identifier(row.get("id"))
        if row_id in seen:
            raise ValueError("控制行 ID 重复。")
        seen.add(row_id)
        count = row.get("count")
        if type(count) is not int or not 1 <= count <= 1000:
            raise ValueError("每行运行次数必须为 1–1000。")
        if "prompts" in row:
            prompts = row["prompts"]
            if not isinstance(prompts, list) or len(prompts) > 512:
                raise ValueError("文本节点配置无效（每组最多 512 个）。")
            node_ids = set()
            for entry in prompts:
                if not isinstance(entry, dict) or type(entry.get("text_node_id")) not in (str, int) or not str(entry["text_node_id"]):
                    raise ValueError("文本节点引用格式无效。")
                node_id = str(entry["text_node_id"])
                if node_id in node_ids:
                    raise ValueError("同一分组不能重复控制同一个文本节点。")
                node_ids.add(node_id)
                if not isinstance(entry.get("prompt"), str) or len(entry["prompt"]) > 50000:
                    raise ValueError("每个提示词最多 50000 字符。")
                if "variants" in entry and (not isinstance(entry["variants"], list) or not 1 <= len(entry["variants"]) <= 1000
                                            or any(not isinstance(value, str) or len(value) > 50000 for value in entry["variants"])):
                    raise ValueError("批量提示词需要 1–1000 个文本框，每框最多 50000 字符。")
        elif not isinstance(row.get("prompt"), str) or len(row["prompt"]) > 50000:
            raise ValueError("每个提示词最多 50000 字符。")
        if row.get("group") is not None and not isinstance(row["group"], dict):
            raise ValueError("分组引用格式无效。")
        if row.get("text_node_id") is not None and not isinstance(row["text_node_id"], (str, int)):
            raise ValueError("文本节点引用格式无效。")
        if "eagle" in row:
            eagle = row["eagle"]
            if not isinstance(eagle, dict):
                raise ValueError("Eagle 控制配置无效。")
            for field in ("folder_id", "folder_label", "filename_prefix"):
                if not isinstance(eagle.get(field), str) or len(eagle[field]) > 2000:
                    raise ValueError("Eagle 目录或文件名前缀无效。")
            for field in ("save_eagle", "save_output", "annotation", "tags"):
                if type(eagle.get(field)) is not bool:
                    raise ValueError("Eagle 开关配置无效。")
            if eagle.get("library_key") is not None and (not isinstance(eagle["library_key"], str) or len(eagle["library_key"]) > 2000):
                raise ValueError("Eagle 素材库标识无效。")
            # Connection credentials always come from the node, not the binding.
            if set(eagle) - {"folder_id", "folder_label", "filename_prefix", "save_eagle", "save_output", "annotation", "tags", "library_key"}:
                raise ValueError("Eagle 控制配置包含未知字段。")
    if len(json.dumps(data, ensure_ascii=False)) > 4_000_000:
        raise ValueError("配置过大。")
    return {"version": data["version"], "workflow": dict(workflow), "rows": rows, "updated_at": time.time()}


class BindingStore:
    def __init__(self, directory):
        self.path = Path(directory) / "bindings.json"

    def read(self):
        with _lock:
            if not self.path.exists():
                return {}
            data = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                raise ValueError("绑定文件格式无效，请检查 bindings.json。")
            return data

    def write(self, key, value=None):
        identifier(key)
        with _lock:
            data = self.read()
            if value is None:
                data.pop(key, None)
            else:
                data[key] = validate_config(value)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_name("bindings." + uuid.uuid4().hex + ".tmp")
            try:
                temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
                temporary.replace(self.path)
            finally:
                temporary.unlink(missing_ok=True)
            return data.get(key)
