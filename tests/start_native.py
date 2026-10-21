"""CPU-only native test instance with a private graph/user directory."""
from pathlib import Path
import os
import subprocess

WORKSPACE = Path(__file__).parents[2]
NATIVE = Path(r"G:\A-Comfyui-video\AI-T8-video-onekey\ComfyUI")
PYTHON = NATIVE.parent / "python/python.exe"
BASE = WORKSPACE / ".group-runner-native-test"
for name in ("user", "input", "output", "temp", "models", "custom_nodes"):
    (BASE / name).mkdir(parents=True, exist_ok=True)
extra = BASE / "extra_paths.yaml"
extra.write_text("group_runner_test:\n  base_path: " + WORKSPACE.as_posix() + "\n  custom_nodes: .\n", encoding="utf-8")
command = [str(PYTHON), str(NATIVE / "main.py"), "--cpu", "--offline", "--disable-auto-launch", "--disable-all-custom-nodes", "--whitelist-custom-nodes", "ComfyUI-GroupRunner", "--extra-model-paths-config", str(extra), "--base-directory", str(BASE), "--user-directory", str(BASE / "user"), "--port", "8199", "--front-end-root", str(PYTHON.parent / "Lib/site-packages/comfyui_frontend_package/static")]
raise SystemExit(subprocess.call(command, cwd=BASE, env={**os.environ, "PYTHONDONTWRITEBYTECODE": "1", "HF_HUB_OFFLINE": "1", "PYTHONIOENCODING": "utf-8"}))
