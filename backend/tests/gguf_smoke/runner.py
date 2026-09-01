#!/usr/bin/env python3
"""Reference local_cli runner for a GGUF-quantized SD3.5-medium transformer (diffusers).

Demonstrates the supported GGUF loading pattern:

  1. `gguf`, `accelerate` and `transformers` are installed in the venv
  2. the backbone (the DiT transformer) is loaded from a single .gguf file with
     ``GGUFQuantizationConfig`` — pipeline-level ``from_pretrained("....gguf")``
     is NOT supported and is not what this does
  3. the rest of the pipeline (text encoders, VAE, tokenizers, scheduler) is
     loaded from the diffusers-format base repo's plain .safetensors /
     pretrained dirs alongside the GGUF

GGUF + diffusers only covers DiT/transformer backbones (FLUX, SD3/3.5, Wan,
LTX, HiDream, Qwen-Image, ...). UNet models (SD 1.5/SDXL) cannot be loaded
from GGUF in diffusers — their 4-D conv weights are not representable, and
third-party SDXL GGUFs store convs as flat 2-D matrices the loader rejects.

Expected weights-dir layout:

  <weights-dir>/
    <name>.gguf                    (exactly one top-level .gguf, or --transformer-gguf)
    base/
      transformer/config.json      (diffusers-format config; pins the model
                                    architecture for from_single_file)
      text_encoder/    (CLIP-L text tower, 768)
      text_encoder_2/  (CLIP-G text tower, 1280 — its pooled output with
                        text_encoder's gives the transformer's 2048 pooled dim)
      text_encoder_3/  (T5-XXL text tower, 4096 — the only stream fed to joint
                        attention)
      vae/  tokenizer/  tokenizer_2/  tokenizer_3/  scheduler/

Usage:
  python runner.py --prompt "a lighthouse at dawn" --seed 7 --output out.png \
      --weights-dir /path/to/weights [--steps 4] [--width 512] [--height 512]
      [--device auto|cpu|cuda]

Prints a single ``GGUF_SMOKE_OK`` summary line on success so callers can
grep for it.
"""

import argparse
import glob
import json
import os
import sys
import time

import torch
from diffusers import (
    AutoencoderKL,
    GGUFQuantizationConfig,
    StableDiffusion3Pipeline,
    SD3Transformer2DModel,
)
from transformers import AutoTokenizer, CLIPTextModelWithProjection, T5EncoderModel


def find_gguf(weights_dir, explicit=None):
    if explicit:
        path = explicit
        if not os.path.isabs(path):
            path = os.path.join(weights_dir, path)
    else:
        matches = sorted(glob.glob(os.path.join(weights_dir, "*.gguf")))
        if len(matches) != 1:
            sys.exit(f"expected exactly one .gguf in {weights_dir}, found {len(matches)}")
        path = matches[0]
    if not os.path.isfile(path):
        sys.exit(f"GGUF file not found: {path}")
    return path


def seed_to_int(seed: str) -> int:
    """The app passes seed strings through verbatim (benchmark seeds like
    'bench-<model-id>' and the per-candidate '<seed>:<i>' derivation).
    Numeric seeds are used as-is; anything else is hashed (FNV-1a) to a
    deterministic uint32."""
    s = seed.strip()
    if s.lstrip("-").isdigit():
        return int(s)
    h = 0x811C9DC5
    for b in s.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return h


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--seed", default="42")
    parser.add_argument("--output", required=True)
    parser.add_argument(
        "--image",
        default=None,
        help="reference image (accepted for CLI compatibility; this t2i smoke "
        "runner ignores it)",
    )
    parser.add_argument("--weights-dir", required=True)
    parser.add_argument(
        "--transformer-gguf", default=None, help="GGUF path (default: the single .gguf in weights-dir)"
    )
    parser.add_argument("--steps", type=int, default=4)
    parser.add_argument("--width", type=int, default=512)
    parser.add_argument("--height", type=int, default=512)
    parser.add_argument("--device", default="auto", choices=["auto", "cpu", "cuda"])
    args = parser.parse_args()

    if args.image:
        print(f"note: --image given but this t2i reference runner ignores it ({args.image})", file=sys.stderr)

    min_free_vram_gb = 50  # weights (~35 GiB) + activations at 1024px
    device = args.device
    free_vram_gib = None
    if device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cuda":
        free, total = torch.cuda.mem_get_info()
        free_vram_gib = round(free / 1024 ** 3, 1)
        if free < min_free_vram_gb * 1024 ** 3:
            print(f"gpu free {free_vram_gib} GiB < {min_free_vram_gb} GiB required — falling back to cpu", flush=True)
            device = "cpu"
    # Machine-readable status line: the local_cli adapter forwards it to the
    # job card as a runner.log event (which device the run uses, live).
    status = {"device": device}
    if free_vram_gib is not None:
        status["free_vram_gib"] = free_vram_gib
    print("RUNNER_STATUS " + json.dumps(status), flush=True)
    torch.set_num_threads(min(16, os.cpu_count() or 1))

    gguf_path = find_gguf(args.weights_dir, args.transformer_gguf)
    base = args.weights_dir.rstrip("/") + "/base"
    for required in (
        os.path.join(base, "transformer", "config.json"),
        os.path.join(base, "text_encoder"),
        os.path.join(base, "text_encoder_2"),
        os.path.join(base, "text_encoder_3"),
        os.path.join(base, "vae"),
        os.path.join(base, "tokenizer"),
        os.path.join(base, "tokenizer_2"),
        os.path.join(base, "tokenizer_3"),
        os.path.join(base, "scheduler"),
    ):
        if not os.path.exists(required):
            sys.exit(f"missing required file or dir: {required}")

    t0 = time.time()
    print(f"loading GGUF backbone: {gguf_path}", file=sys.stderr)
    transformer = SD3Transformer2DModel.from_single_file(
        gguf_path,
        quantization_config=GGUFQuantizationConfig(compute_dtype=torch.bfloat16),
        config=base,
        subfolder="transformer",
    )
    print("loading text encoders", file=sys.stderr)
    # The GGUF transformer computes in bf16, so every component is loaded in
    # bf16 too (the canonical GGUF recipe) — mixed fp32/bf16 breaks the
    # first conv2d with an input/bias dtype mismatch.
    text_encoder = CLIPTextModelWithProjection.from_pretrained(
        os.path.join(base, "text_encoder"), torch_dtype=torch.bfloat16
    )
    text_encoder_2 = CLIPTextModelWithProjection.from_pretrained(
        os.path.join(base, "text_encoder_2"), torch_dtype=torch.bfloat16
    )
    text_encoder_3 = T5EncoderModel.from_pretrained(
        os.path.join(base, "text_encoder_3"), torch_dtype=torch.bfloat16
    )
    print("loading vae / tokenizers / scheduler", file=sys.stderr)
    vae = AutoencoderKL.from_pretrained(os.path.join(base, "vae"), torch_dtype=torch.bfloat16)
    tokenizer = AutoTokenizer.from_pretrained(os.path.join(base, "tokenizer"))
    tokenizer_2 = AutoTokenizer.from_pretrained(os.path.join(base, "tokenizer_2"))
    tokenizer_3 = AutoTokenizer.from_pretrained(os.path.join(base, "tokenizer_3"))
    from diffusers import FlowMatchEulerDiscreteScheduler

    scheduler = FlowMatchEulerDiscreteScheduler.from_pretrained(os.path.join(base, "scheduler"))

    # SD3.5-medium conditions on three text encoders: CLIP-L (768) and CLIP-G
    # (1280) pooled outputs feed the 2048 pooled projection; the T5 stream
    # (4096) is the only one fed to joint attention.
    pipe = StableDiffusion3Pipeline(
        transformer=transformer,
        vae=vae,
        text_encoder=text_encoder,
        text_encoder_2=text_encoder_2,
        text_encoder_3=text_encoder_3,
        tokenizer=tokenizer,
        tokenizer_2=tokenizer_2,
        tokenizer_3=tokenizer_3,
        scheduler=scheduler,
    )
    print(f"pipeline ready in {time.time() - t0:.1f}s, generating on {device}", file=sys.stderr)

    t1 = time.time()
    generator = torch.Generator(device="cpu").manual_seed(seed_to_int(args.seed))
    image = pipe(
        args.prompt,
        num_inference_steps=args.steps,
        width=args.width,
        height=args.height,
        guidance_scale=0.0,
        generator=generator,
    ).images[0]
    gen_seconds = time.time() - t1

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    image.save(args.output)
    size = os.path.getsize(args.output)
    if size < 1024:
        sys.exit(f"output suspiciously small: {args.output} ({size} bytes)")
    print(
        f"GGUF_SMOKE_OK bytes={size} gen_seconds={gen_seconds:.1f} "
        f"steps={args.steps} size={args.width}x{args.height} device={device}",
        flush=True,
    )


if __name__ == "__main__":
    main()
