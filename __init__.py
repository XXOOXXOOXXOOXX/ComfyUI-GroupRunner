from .nodes import GroupRunnerText, GroupRunnerTarget

NODE_CLASS_MAPPINGS = {"GroupRunnerText": GroupRunnerText, "GroupRunnerTarget": GroupRunnerTarget}
NODE_DISPLAY_NAME_MAPPINGS = {"GroupRunnerText": "框运行 · 通用文本", "GroupRunnerTarget": "框运行 · 执行终点（内部）"}
WEB_DIRECTORY = "./web"

from . import routes

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
