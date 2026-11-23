# 自建朗读服务（CosyVoice）

给 Book Read 用的本地 TTS 服务：把 [CosyVoice](https://github.com/FunAudioLLM/CosyVoice) 包成应用约定的两个 HTTP 接口。

```
GET  /health  → {"ok": true, "voices": [{"id": "中文女", "name": "中文女", "lang": "zh-CN"}]}
POST /tts     → 200 audio/wav（16 bit 单声道）
```

本目录只包含包装层（`server.py`）。**CosyVoice 本体和模型不随仓库分发**，需要按下面的步骤自己下载。

```
tts-server/
├── server.py          # FastAPI 包装层：/health + /tts
├── requirements.txt   # 本层依赖（fastapi + uvicorn）
├── README.md          # 本教程
├── CosyVoice/         # 第 2 步克隆，已被 .gitignore 忽略
└── pretrained_models/ # 第 3 步下模型（默认放在 CosyVoice/pretrained_models 下）
```

---

## 0. 前置条件

- **Python 3.10**（CosyVoice 官方要求；3.11+ 部分依赖没有现成轮子，不建议）
- git、curl
- 磁盘：模型约 2 GB（CosyVoice2-0.5B），加上 Python 依赖约 5–8 GB
- 硬件：
  - NVIDIA GPU（Linux / Windows）：接近实时，推荐
  - macOS Apple Silicon：可用 CPU 推理，但明显慢于实时，长句首字延迟可能需要几秒
  - 内存建议 16 GB 起

推荐用 conda 管理环境，下面的命令以 macOS / Linux 的 zsh、Windows 的 PowerShell 都适用（`conda activate` 那步 Windows 可能需要先 `conda init powershell`）。

---

## 1. 准备 Python 环境

```bash
conda create -y -n cosyvoice python=3.10
conda activate cosyvoice
```

后面所有命令都在这个环境里执行。

## 2. 克隆 CosyVoice 到本目录

```bash
cd tts-server
git clone --recursive https://github.com/FunAudioLLM/CosyVoice.git
```

必须带 `--recursive`，否则缺少 `third_party/Matcha-TTS` 子模块。

## 3. 安装依赖

```bash
# CosyVoice 自己的依赖（torch / torchaudio / numpy 等都在这里）
pip install -r CosyVoice/requirements.txt

# 本目录的包装层依赖
pip install -r requirements.txt
```

**Apple Silicon / 部分 Linux 上装不到 pynini 时**（`pip install` 报 `pynini` 编译失败），改用官方推荐的 conda 路线：

```bash
conda install -y -c conda-forge pynini==2.1.5
pip install WeTextProcessing==1.0.4.7
```

> 没有 NVIDIA GPU 时，装 CPU 版 torch 即可：`pip install torch torchaudio`。有 GPU 时按 [PyTorch 官网](https://pytorch.org/get-started/locally/) 选对应 CUDA 版本。

## 4. 下载模型

默认使用 `CosyVoice2-0.5B`（24 kHz，体积最小、效果够用）。二选一：

**ModelScope（国内快）**

```bash
pip install modelscope
python -c "from modelscope import snapshot_download; snapshot_download('iic/CosyVoice2-0.5B', local_dir='CosyVoice/pretrained_models/CosyVoice2-0.5B')"
```

**HuggingFace**

```bash
pip install huggingface_hub
huggingface-cli download FunAudioLLM/CosyVoice2-0.5B --local-dir CosyVoice/pretrained_models/CosyVoice2-0.5B
```

> 国内访问 HuggingFace 可先设镜像：`export HF_ENDPOINT=https://hf-mirror.com`（Windows：`$env:HF_ENDPOINT="https://hf-mirror.com"`）。

模型目录名建议保留 `CosyVoice2-0.5B`：服务端靠目录名判断该用 `CosyVoice2` 还是 `CosyVoice` 类。改名了就用 `--class` 显式指定。

## 5. 启动服务

```bash
# 在 tts-server 目录下
python server.py
```

默认读取 `./CosyVoice/pretrained_models/CosyVoice2-0.5B`，监听 `127.0.0.1:8000`。

看到这行就绪：

```
[tts-server] 模型就绪：/.../CosyVoice/pretrained_models/CosyVoice2-0.5B（24000 Hz，CosyVoice2）
INFO:     Uvicorn running on http://127.0.0.1:8000
```

首次启动要加载模型，通常 10–60 秒，期间终端没有更多输出是正常的。

常用参数 / 环境变量：

| 参数 | 环境变量 | 默认值 | 说明 |
|---|---|---|---|
| `--host` | `TTS_HOST` | `127.0.0.1` | 只给本机用；局域网共享改成 `0.0.0.0` |
| `--port` | `TTS_PORT` | `8000` | 与应用的默认地址一致 |
| `--cosyvoice-dir` | `COSYVOICE_HOME` | `./CosyVoice` | CosyVoice 仓库位置 |
| `--model-dir` | `COSYVOICE_MODEL_DIR` | `<cosyvoice-dir>/pretrained_models/CosyVoice2-0.5B` | 模型目录 |
| `--class` | `COSYVOICE_CLASS` | 按目录名推断 | 强制指定 `CosyVoice` / `CosyVoice2` |
| `--fp16` | `COSYVOICE_FP16=1` | 关 | GPU 上省显存；CPU / macOS 上没收益 |

例：

```bash
python server.py --port 8000 --model-dir ./CosyVoice/pretrained_models/CosyVoice2-0.5B
```

## 6. 验证服务

另开一个终端：

```bash
# 探活 + 音色列表
curl http://127.0.0.1:8000/health

# 合成一句
curl -X POST http://127.0.0.1:8000/tts \
  -H 'content-type: application/json' \
  -d '{"text":"今天天气不错，适合读书。","voice":"中文女","speed":1.0}' \
  -o test.wav

afplay test.wav        # macOS 播放；Windows 直接双击 test.wav
```

`/health` 返回 `ok: true` 且 `test.wav` 能正常播放，说明服务端没问题。

## 7. 在应用里配置

打开书 → 顶栏「朗读」→ 声音设置：

1. **引擎**：自建 CosyVoice 服务
2. **接口形态**：通用 `/tts` 协议
3. **服务地址**：`http://127.0.0.1:8000`
4. 点「检测」，音色下拉里选中 `中文女`（列表为空时直接手填 `中文女`）
5. 语速按需调整

> 不要选「CosyVoice 官方 FastAPI」：那是直连官方 `/inference_sft` 的另一种模式，不需要本服务。用本服务时选「通用 /tts 协议」，采样率也不用填。

读第 N 句时应用会预合成 N+1、N+2，命中磁盘缓存后同一句不会重复合成。缓存在应用数据目录的 `tts-cache/`（上限 200 MB），与本仓库无关。

## 8. 常见问题

**应用提示「连不上朗读服务」**
服务没启动、端口不一致或防火墙拦截。先在终端 `curl http://127.0.0.1:8000/health` 确认。

**`/health` 返回 503 / `ok: false`**
终端里有完整堆栈。常见原因：模型目录不对、`CosyVoice` 没克隆完整（缺 `third_party/Matcha-TTS`）、依赖没装全。

**音色列表是空的**
部分模型快照不带 `spk2info.pt`，`list_available_spks()` 读不到音色。在应用里手填 `spk_id`（如 `中文女`、`中文男`、`英文女`）即可；如果模型确实没有说话人信息，参考官方脚本 `add_zero_shot_spk(...)` + `save_spkinfo()` 注册。

**合成报 `KeyError: 'xxx'`**
`spk_id` 不在 `spk2info` 里。列一下模型目录下 `spk2info.pt` 的键，或换一个内置音色。

**第一次合成特别慢 / 超时**
模型还在加载，或 CPU 推理。应用单次合成超时是 60 秒；macOS 上长句可能接近这个量级，可先试短句。想要接近实时请用带 NVIDIA GPU 的机器。

**端口被占用**
换端口启动 `python server.py --port 8010`，应用地址同步改成 `http://127.0.0.1:8010`。

**想给局域网里的其他设备用**
`python server.py --host 0.0.0.0 --port 8000`，应用地址填 `http://<这台机器的局域网 IP>:8000`。注意这等于对局域网开放了一个无鉴权的合成接口，不要映射到公网。

**怎么卸载 / 清理**
停服务（`Ctrl+C`），删掉 `tts-server/CosyVoice/`（含模型）和 conda 环境 `conda env remove -n cosyvoice`。这些都已被 `.gitignore` 排除，不会进提交。
