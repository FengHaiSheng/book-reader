"""Book Read 自建朗读服务：给 CosyVoice 套一层应用约定的 HTTP 接口。

应用侧只调用两个路由（协议细节见根目录 README「自建朗读服务」）：
  GET  /health  → {"ok": true, "voices": [...]}
  POST /tts     → 200 audio/wav

CosyVoice 本体与模型都不随仓库分发，按同目录 README 的教程自行准备。
"""

from __future__ import annotations

import argparse
import importlib
import inspect
import io
import math
import os
import sys
import threading
import traceback
import wave
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
import torch
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
DEFAULT_SPK = os.environ.get("COSYVOICE_SPK", "中文女")
MAX_TEXT_CHARS = 4000


class Engine:
    """模型加载与推理。加载失败时把原因留在 error 里，/health 会如实报出来。"""

    def __init__(
        self,
        cosyvoice_dir: Path,
        model_dir: Path,
        fp16: bool = False,
        class_name: str = "",
    ) -> None:
        self.cosyvoice_dir = cosyvoice_dir
        self.model_dir = model_dir
        self.fp16 = fp16
        self.class_name = class_name
        self.model = None
        self.sample_rate = 0
        self.error: str | None = None
        # CosyVoice 不是线程安全的；应用会预合成后两句，请求可能并发到达
        self.lock = threading.Lock()

    def load(self) -> None:
        if not self.model_dir.is_dir():
            self.error = f"模型目录不存在：{self.model_dir}（先按 README 下载模型）"
            print(f"[tts-server] {self.error}", file=sys.stderr)
            return

        self._prepare_import_path()
        try:
            module = importlib.import_module("cosyvoice.cli.cosyvoice")
            cls = self._pick_class(module)
            self.model = _construct(cls, self.model_dir, self.fp16)
            self.sample_rate = int(getattr(self.model, "sample_rate", 22050))
            self.error = None
            print(
                f"[tts-server] 模型就绪：{self.model_dir}（{self.sample_rate} Hz，{cls.__name__}）"
            )
            if not self.voices():
                print(
                    "[tts-server] 提示：没读到内置音色（可能缺 spk2info），"
                    "在应用里手填 spk_id 即可，例如 中文女。"
                )
        except Exception as exc:  # 依赖缺失、模型损坏、显存不足都在这里
            self.error = f"加载 CosyVoice 失败：{exc}"
            traceback.print_exc()

    def _prepare_import_path(self) -> None:
        # 官方仓库不要求 pip install，从仓库根目录运行即可导入；
        # 我们把这两条路径补上，用户不必再设 PYTHONPATH。
        for path in (self.cosyvoice_dir, self.cosyvoice_dir / "third_party" / "Matcha-TTS"):
            text = str(path)
            if path.is_dir() and text not in sys.path:
                sys.path.insert(0, text)

    def _pick_class(self, module):
        if self.class_name:
            cls = getattr(module, self.class_name, None)
            if cls is None:
                raise RuntimeError(f"cosyvoice 包里没有类 {self.class_name}")
            return cls
        # 目录名带版本最可靠：CosyVoice2-0.5B / CosyVoice-300M-SFT
        name = self.model_dir.name.lower()
        for token, attr in (("cosyvoice3", "CosyVoice3"), ("cosyvoice2", "CosyVoice2")):
            if token in name and hasattr(module, attr):
                return getattr(module, attr)
        if hasattr(module, "CosyVoice"):
            return module.CosyVoice
        for attr in ("CosyVoice2", "CosyVoice3"):
            if hasattr(module, attr):
                return getattr(module, attr)
        raise RuntimeError("cosyvoice 包已安装，但找不到 CosyVoice / CosyVoice2 类")

    def voices(self) -> list[dict[str, str]]:
        if self.model is None:
            return []
        try:
            spks = self.model.list_available_spks()
        except Exception:
            return []
        result: list[dict[str, str]] = []
        for spk in spks or []:
            name = str(spk)
            result.append({"id": name, "name": name, "lang": _lang_of(name)})
        return result

    def synthesize(self, text: str, spk: str, speed: float) -> bytes:
        if self.model is None:
            raise RuntimeError(self.error or "模型还没加载完")

        fn = self.model.inference_sft
        kwargs = {}
        # CosyVoice1 没有 speed 参数，按签名判断，避免 TypeError
        if "speed" in inspect.signature(fn).parameters:
            kwargs["speed"] = speed

        chunks = list(fn(text, spk, stream=False, **kwargs))
        speech = [chunk["tts_speech"] for chunk in chunks if "tts_speech" in chunk]
        if not speech:
            raise RuntimeError("模型没有产出音频")
        audio = torch.cat(speech, dim=-1).detach().to(torch.float32).cpu().numpy().reshape(-1)
        return _wav_bytes(audio, self.sample_rate)


def _construct(cls, model_dir: Path, fp16: bool):
    params = inspect.signature(cls.__init__).parameters
    kwargs = {}
    for key, value in (("load_jit", False), ("load_trt", False), ("fp16", fp16)):
        if key in params:
            kwargs[key] = value
    return cls(str(model_dir), **kwargs)


def _lang_of(spk: str) -> str:
    if spk.startswith(("英文", "en_", "en-", "English")):
        return "en-US"
    if spk.startswith(("日文", "jp", "ja")):
        return "ja-JP"
    return "zh-CN"


def _wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    pcm16 = (np.clip(samples, -1.0, 1.0) * 32767.0).astype("<i2")
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(int(sample_rate) or 22050)
        handle.writeframes(pcm16.tobytes())
    return buffer.getvalue()


def _env_config() -> tuple[Path, Path, bool, str]:
    cosyvoice_dir = Path(os.environ.get("COSYVOICE_HOME", HERE / "CosyVoice")).expanduser()
    model_dir = Path(
        os.environ.get(
            "COSYVOICE_MODEL_DIR",
            cosyvoice_dir / "pretrained_models" / "CosyVoice2-0.5B",
        )
    ).expanduser()
    fp16 = os.environ.get("COSYVOICE_FP16", "").strip().lower() in {"1", "true", "yes", "on"}
    return cosyvoice_dir, model_dir, fp16, os.environ.get("COSYVOICE_CLASS", "")


ENGINE = Engine(*_env_config())


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # 同步加载：uvicorn 打印 startup complete 时模型已经可用，
    # 应用的探活（4 秒超时）不会撞上「还没加载完」。
    ENGINE.load()
    yield


app = FastAPI(title="Book Read TTS", lifespan=lifespan)


@app.get("/health")
def health():
    if ENGINE.model is None:
        return JSONResponse(
            {"ok": False, "error": ENGINE.error or "模型还在加载"},
            status_code=503,
        )
    return {"ok": True, "sample_rate": ENGINE.sample_rate, "voices": ENGINE.voices()}


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TEXT_CHARS)
    voice: str = ""
    speed: float = 1.0


@app.post("/tts")
def synthesize(body: TtsRequest):
    if ENGINE.model is None:
        raise HTTPException(status_code=503, detail=ENGINE.error or "模型还在加载")

    text = body.text.strip()
    if text == "":
        raise HTTPException(status_code=400, detail="text 不能为空")
    speed = body.speed if math.isfinite(body.speed) else 1.0
    speed = min(max(speed, 0.5), 2.0)
    spk = body.voice.strip() or DEFAULT_SPK

    try:
        with ENGINE.lock:
            audio = ENGINE.synthesize(text, spk, speed)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"合成失败：{exc}") from exc
    return Response(content=audio, media_type="audio/wav")


def main() -> None:
    global ENGINE
    parser = argparse.ArgumentParser(description="Book Read 自建朗读服务（CosyVoice）")
    parser.add_argument("--host", default=os.environ.get("TTS_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("TTS_PORT", "8000")))
    parser.add_argument("--cosyvoice-dir", default=str(ENGINE.cosyvoice_dir))
    parser.add_argument("--model-dir", default=str(ENGINE.model_dir))
    parser.add_argument("--class", dest="class_name", default=ENGINE.class_name)
    parser.add_argument("--fp16", action="store_true", default=ENGINE.fp16)
    args = parser.parse_args()

    ENGINE = Engine(
        Path(args.cosyvoice_dir).expanduser(),
        Path(args.model_dir).expanduser(),
        args.fp16,
        args.class_name,
    )

    import uvicorn

    uvicorn.run(app, host=args.host, port=args.port, log_level="info")


if __name__ == "__main__":
    main()
