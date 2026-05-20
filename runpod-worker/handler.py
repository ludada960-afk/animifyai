"""
AnimifyAI — RunPod Serverless Worker
Animagine XL 4.0 img2img anime style transfer
"""

import runpod
import torch
from diffusers import StableDiffusionXLImg2ImgPipeline, AutoencoderKL
from PIL import Image
import base64
import io
import os
import time

MODEL_ID = "cagliostrolab/animagine-xl-4.0"
VAE_ID = "madebyollin/sdxl-vae-fp16-fix"
MODEL_CACHE = os.environ.get("MODEL_CACHE", "/app/models")

# Style prompts — Animagine XL uses Danbooru-style tagging
STYLE_PROMPTS = {
    "ghibli": (
        "ghibli style, studio ghibli, soft watercolor, warm colors, hand-drawn, "
        "masterpiece, best quality, very aesthetic, absurdres"
    ),
    "shinkai": (
        "makoto shinkai style, cinematic lighting, luminous sky, vivid colors, "
        "beautiful clouds, masterpiece, best quality, very aesthetic, absurdres"
    ),
    "ukiyoe": (
        "ukiyo-e, japanese woodblock print, bold outlines, flat colors, traditional, "
        "masterpiece, best quality, very aesthetic, absurdres"
    ),
    "cyberpunk": (
        "cyberpunk, neon lights, purple cyan, futuristic, dark moody, glowing, "
        "masterpiece, best quality, very aesthetic, absurdres"
    ),
    "watercolor": (
        "watercolor painting, soft pastel, delicate brush strokes, ethereal, "
        "masterpiece, best quality, very aesthetic, absurdres"
    ),
    "chibi": (
        "chibi, kawaii, cute big head, sparkling eyes, pastel, adorable, "
        "masterpiece, best quality, very aesthetic, absurdres"
    ),
}

NEGATIVE = "low quality, worst quality, blurry, ugly, deformed, bad anatomy, watermark, text, signature"

pipe = None


def load_pipe():
    global pipe
    vae = AutoencoderKL.from_pretrained(
        VAE_ID,
        torch_dtype=torch.float16,
        cache_dir=MODEL_CACHE,
    )
    pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained(
        MODEL_ID,
        vae=vae,
        torch_dtype=torch.float16,
        use_safetensors=True,
        cache_dir=MODEL_CACHE,
    )
    pipe.to("cuda")
    print(f"[animify] Model loaded. VRAM: {torch.cuda.max_memory_allocated() / 1024**3:.1f}GB")


def decode_image(b64_str):
    """Decode base64 image, handling optional data URI prefix."""
    if "," in b64_str:
        b64_str = b64_str.split(",")[1]
    raw = base64.b64decode(b64_str)
    return Image.open(io.BytesIO(raw)).convert("RGB")


def encode_image(img):
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("utf-8")


def handler(job):
    global pipe
    if pipe is None:
        load_pipe()

    inp = job.get("input", job)
    init = decode_image(inp["image"])
    w, h = init.size
    w = (w // 8) * 8
    h = (h // 8) * 8
    w = min(w, 1024)
    h = min(h, 1024)
    if (w, h) != init.size:
        init = init.resize((w, h))

    style = inp.get("style", "")
    base_prompt = STYLE_PROMPTS.get(style, STYLE_PROMPTS["ghibli"])
    quality = inp.get("quality", "high")
    if quality == "paid":
        extra = "highly detailed, sharp focus, HQ, anime illustration"
    else:
        extra = "anime style"
    prompt = f"{base_prompt}, {extra}"
    negative = inp.get("negative_prompt", NEGATIVE)
    strength = float(inp.get("strength", 0.75))
    guidance = float(inp.get("guidance_scale", 7.5))
    steps = int(inp.get("num_steps", 6))

    t0 = time.time()
    result = pipe(
        prompt=prompt,
        negative_prompt=negative,
        image=init,
        strength=strength,
        guidance_scale=guidance,
        num_inference_steps=steps,
    ).images[0]
    elapsed = time.time() - t0

    print(f"[animify] Generated {w}x{h} in {elapsed:.1f}s — steps={steps} strength={strength}")

    return {"image": encode_image(result), "elapsed": round(elapsed, 1)}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
