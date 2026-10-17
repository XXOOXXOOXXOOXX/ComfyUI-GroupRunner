from aiohttp import web
import folder_paths
from server import PromptServer
from .storage import BindingStore, identifier


def store():
    from pathlib import Path
    return BindingStore(Path(folder_paths.get_user_directory()) / "group_runner")


def job_tag(item):
    try:
        return item[3]["extra_pnginfo"]["workflow"]["extra"]["group_runner_run"]
    except (KeyError, IndexError, TypeError):
        return {}


def cancel_jobs(queue, session, jobs, interrupt):
    """Never clear the queue or interrupt a prompt from another row/client."""
    identifier(session)
    if not isinstance(jobs, list) or len(jobs) > 64:
        raise ValueError("取消任务列表无效。")
    wanted = {identifier(job) for job in jobs}
    def owned(item):
        tag = job_tag(item)
        return isinstance(tag, dict) and tag.get("session") == session and tag.get("job") in wanted
    removed, interrupted = 0, False
    # PromptQueue uses an RLock. Hold it while matching and interrupting so a
    # finished owned task cannot be replaced by an unrelated task in between.
    with queue.mutex:
        while queue.delete_queue_item(owned):
            removed += 1
        if any(owned(item) for item in queue.currently_running.values()):
            interrupt()
            interrupted = True
    return {"removed": removed, "interrupted": interrupted}


def register():
    routes = PromptServer.instance.routes
    @routes.get("/group_runner/bindings")
    async def bindings(request):
        try:
            current = store()
            return web.json_response({"ok": True, "bindings": current.read(), "path": str(current.path)})
        except (ValueError, OSError) as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @routes.put("/group_runner/bindings/{key}")
    async def save(request):
        try:
            if request.content_length and request.content_length > 5_000_000:
                raise ValueError("配置过大。")
            result = store().write(request.match_info["key"], await request.json())
            return web.json_response({"ok": True, "binding": result})
        except (ValueError, OSError) as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @routes.delete("/group_runner/bindings/{key}")
    async def remove(request):
        try:
            store().write(request.match_info["key"])
            return web.json_response({"ok": True})
        except (ValueError, OSError) as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @routes.post("/group_runner/cancel")
    async def cancel(request):
        try:
            import nodes
            data = await request.json()
            result = cancel_jobs(PromptServer.instance.prompt_queue, data.get("session"), data.get("jobs"), nodes.interrupt_processing)
            return web.json_response({"ok": True, **result})
        except (ValueError, TypeError) as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)


if getattr(PromptServer, "instance", None) is not None:
    register()
