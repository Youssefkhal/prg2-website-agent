"""
GPU server for the multi-agent website builder — runs on Google Colab (T4 GPU).

All GPU work of the project happens here:
  * POST /generate : text-to-image (SDXL-Turbo, fp16) for website visuals
  * POST /embed    : multilingual sentence embeddings used for semantic skill retrieval
  * GET  /health   : status, device, loaded models

The server is exposed to the NestJS backend through a free Cloudflare quick tunnel
(https://xxxx.trycloudflare.com). Copy the printed URL + token into backend/.env:
    COLAB_GPU_URL=https://xxxx.trycloudflare.com
    COLAB_GPU_TOKEN=<token>

Usage in Colab (Runtime > Change runtime type > T4 GPU):
    !pip install -q diffusers==0.31.0 transformers accelerate sentence-transformers fastapi uvicorn
    !python gpu_server.py            # or run the cells of gpu_server.ipynb
"""
import base64
import io
import os
import re
import secrets
import subprocess
import threading
import time
from typing import List, Optional

import torch
import uvicorn
from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

IMAGE_MODEL_ID = os.environ.get("IMAGE_MODEL_ID", "stabilityai/sdxl-turbo")
VAE_ID = os.environ.get("VAE_ID", "madebyollin/sdxl-vae-fp16-fix")
EMBED_MODEL_ID = os.environ.get("EMBED_MODEL_ID", "intfloat/multilingual-e5-small")
PORT = int(os.environ.get("PORT", "8000"))
API_TOKEN = os.environ.get("GPU_API_TOKEN") or secrets.token_urlsafe(24)

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
DTYPE = torch.float16 if DEVICE == "cuda" else torch.float32

# One lock: the T4 has 16 GB, we never run two GPU jobs at the same time.
gpu_lock = threading.Lock()
_image_pipe = None
_embedder = None


def get_image_pipe():
    global _image_pipe
    if _image_pipe is None:
        from diffusers import AutoPipelineForText2Image, AutoencoderKL

        kwargs = {"torch_dtype": DTYPE}
        if DEVICE == "cuda":
            kwargs["variant"] = "fp16"
            # The stock SDXL VAE overflows in fp16 (black images); use the fixed one.
            kwargs["vae"] = AutoencoderKL.from_pretrained(VAE_ID, torch_dtype=DTYPE)
        pipe = AutoPipelineForText2Image.from_pretrained(IMAGE_MODEL_ID, **kwargs)
        pipe = pipe.to(DEVICE)
        pipe.set_progress_bar_config(disable=True)
        if DEVICE == "cuda":
            pipe.enable_attention_slicing()
        _image_pipe = pipe
    return _image_pipe


def get_embedder():
    global _embedder
    if _embedder is None:
        from sentence_transformers import SentenceTransformer

        _embedder = SentenceTransformer(EMBED_MODEL_ID, device=DEVICE)
        if DEVICE == "cuda":
            _embedder = _embedder.half()
    return _embedder


def check_token(x_api_key: Optional[str] = Header(default=None)):
    if x_api_key != API_TOKEN:
        raise HTTPException(status_code=401, detail="invalid x-api-key")


app = FastAPI(title="Website-agent GPU server (Colab T4)")


class GenerateRequest(BaseModel):
    prompt: str
    negative_prompt: Optional[str] = None
    width: int = Field(768, ge=256, le=1024)
    height: int = Field(512, ge=256, le=1024)
    steps: int = Field(4, ge=1, le=50)
    guidance_scale: float = Field(0.0, ge=0.0, le=15.0)
    seed: Optional[int] = None


class EmbedRequest(BaseModel):
    texts: List[str]
    kind: str = "passage"  # "query" | "passage" (e5 models need the prefix)


def _snap(v: int) -> int:
    return max(256, min(1024, int(round(v / 64)) * 64))


@app.get("/health")
def health():
    info = {"ok": True, "device": DEVICE, "image_model": IMAGE_MODEL_ID, "embed_model": EMBED_MODEL_ID,
            "image_loaded": _image_pipe is not None, "embed_loaded": _embedder is not None}
    if DEVICE == "cuda":
        info["gpu"] = torch.cuda.get_device_name(0)
        info["vram_used_gb"] = round(torch.cuda.memory_allocated() / 1e9, 2)
    return info


@app.post("/generate", dependencies=[Depends(check_token)])
def generate(req: GenerateRequest):
    t0 = time.time()
    seed = req.seed if req.seed is not None else secrets.randbelow(2**31)
    with gpu_lock:
        pipe = get_image_pipe()
        generator = torch.Generator(device=DEVICE).manual_seed(seed)
        kwargs = dict(prompt=req.prompt, width=_snap(req.width), height=_snap(req.height),
                      num_inference_steps=req.steps, guidance_scale=req.guidance_scale, generator=generator)
        # SDXL-Turbo ignores negative prompts when guidance_scale == 0
        if req.negative_prompt and req.guidance_scale > 1.0:
            kwargs["negative_prompt"] = req.negative_prompt
        with torch.inference_mode():
            image = pipe(**kwargs).images[0]
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return {"image_base64": base64.b64encode(buf.getvalue()).decode(), "seed": seed,
            "width": image.width, "height": image.height, "elapsed_s": round(time.time() - t0, 2)}


@app.post("/embed", dependencies=[Depends(check_token)])
def embed(req: EmbedRequest):
    if not req.texts:
        return {"embeddings": [], "dim": 0}
    prefix = "query: " if req.kind == "query" else "passage: "
    texts = [prefix + t for t in req.texts] if "e5" in EMBED_MODEL_ID else req.texts
    with gpu_lock:
        vecs = get_embedder().encode(texts, batch_size=64, normalize_embeddings=True, convert_to_numpy=True)
    return {"embeddings": vecs.astype("float32").tolist(), "dim": int(vecs.shape[1])}


def start_tunnel(port: int) -> str:
    """Start a Cloudflare quick tunnel and return its public URL."""
    if not os.path.exists("/usr/local/bin/cloudflared"):
        subprocess.run(["wget", "-q", "-O", "/usr/local/bin/cloudflared",
                        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"],
                       check=True)
        os.chmod("/usr/local/bin/cloudflared", 0o755)
    subprocess.run("pkill -f 'cloudflared tunnel'", shell=True)
    log = "/tmp/cloudflared.log"
    subprocess.Popen(f"/usr/local/bin/cloudflared tunnel --no-autoupdate --url http://localhost:{port} > {log} 2>&1", shell=True)
    deadline = time.time() + 180  # quick tunnels can take 1-2 minutes to come up
    while time.time() < deadline:
        time.sleep(3)
        try:
            m = re.search(r"https://[a-z0-9-]+\.trycloudflare\.com", open(log).read())
        except FileNotFoundError:
            m = None
        if m:
            return m.group(0)
    raise RuntimeError(f"cloudflared did not print a URL within 180 s (see {log})")


def run_server_in_background(port: int = PORT):
    config = uvicorn.Config(app, host="0.0.0.0", port=port, log_level="warning")
    server = uvicorn.Server(config)
    threading.Thread(target=server.run, daemon=True).start()
    for _ in range(50):
        if server.started:
            break
        time.sleep(0.2)
    return server


def main(preload: bool = True):
    print(f"Device: {DEVICE}" + (f" ({torch.cuda.get_device_name(0)})" if DEVICE == "cuda" else ""))
    if preload:
        print("Loading models on the GPU (first time: ~2-4 min download)…")
        get_image_pipe()
        get_embedder()
    run_server_in_background(PORT)
    url = start_tunnel(PORT)
    print("\n" + "=" * 70)
    print("GPU server ready. Put these two lines in backend/.env :")
    print(f"COLAB_GPU_URL={url}")
    print(f"COLAB_GPU_TOKEN={API_TOKEN}")
    print("=" * 70 + "\n")
    return url


if __name__ == "__main__":
    main()
    while True:  # keep the process (and the tunnel) alive
        time.sleep(3600)
