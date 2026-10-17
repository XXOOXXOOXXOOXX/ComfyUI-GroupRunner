class GroupRunnerText:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"text": ("STRING", {"multiline": True, "default": "", "tooltip": "可从框运行浮窗中编辑；连接至任何 STRING 提示词接口。"})}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "text"
    CATEGORY = "Group Runner"

    def text(self, text):
        return (text,)


class AnyType(str):
    def __ne__(self, other):
        return False


class GroupRunnerTarget:
    """Runtime-only output: allows a group ending at a non-output node to run."""
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"value": (AnyType("*"), {"forceInput": True})}}

    RETURN_TYPES = ()
    OUTPUT_NODE = True
    FUNCTION = "consume"
    CATEGORY = "Group Runner/Internal"

    def consume(self, value):
        return {}
