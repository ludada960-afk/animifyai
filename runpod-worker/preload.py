"""
Pre-download Animagine XL 4.0 + SDXL VAE to a directory.
Run this on a GPU pod with the network volume mounted, then the
serverless worker loads from the volume cache in seconds.

Usage (on GPU pod):
    pip install torch diffusers transformers safetensors
    MODEL_CACHE=/runpod-volume/models python preload.py
"""
import os
import sys
import time
import torch
from diffusers import StableDiffusionXLImg2ImgPipeline, AutoencoderKL

MODEL_ID = "cagliostrolab/animagine-xl-4.0"
VAE_ID = "madebyollin/sdxl-vae-fp16-fix"
CACHE = os.environ.get("MODEL_CACHE", "/runpod-volume/models")

print(f"Cache dir: {CACHE}")
os.makedirs(CACHE, exist_ok=True)

t0 = time.time()

print(f"[1/2] Downloading VAE: {VAE_ID}")
vae = AutoencoderKL.from_pretrained(
    VAE_ID,
    torch_dtype=torch.float16,
    cache_dir=CACHE,
)
print(f"  Done in {time.time()-t0:.0f}s")

t1 = time.time()
print(f"[2/2] Downloading model: {MODEL_ID}")
pipe = StableDiffusionXLImg2ImgPipeline.from_pretrained(
    MODEL_ID,
    vae=vae,
    torch_dtype=torch.float16,
    use_safetensors=True,
    cache_dir=CACHE,
)
print(f"  Done in {time.time()-t1:.0f}s")

total = time.time() - t0
size = _du_size(CACHE)
print(f"\nDone. Total: {total:.0f}s, cache size: {size:.1f}GB")

# Quick smoke test
print("\nRunning smoke test...")
pipe.to("cuda")
dummy = torch.randn(1, 4, 128, 128, device="cuda", dtype=torch.float16)
_ = pipe(prompt="anime girl", num_inference_steps=1, output_type="latent")
print("Smoke test OK — pipeline works!")


def _du_size(path):
    total = 0
    for dirpath, _, filenames in os.walk(path):
        for f in filenames:
            fp = os.path.join(dirpath, f)
            if os.path.isfile(fp):
                total += os.path.getsize(fp)
    return total / (1024**3)
