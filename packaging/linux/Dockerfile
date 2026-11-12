# syntax=docker/dockerfile:1
# Builds MathStudio for Linux x86_64 (AppImage + .deb) with a bundled standalone Python
# (python-build-standalone via uv) holding ManimGL & co, a static ffmpeg and the search model.
# Run through packaging/linux/build.sh.
# manimpango publishes no Linux wheels (it links the system pango): build one on Ubuntu 22.04 so its
# glibc floor stays low (runs on Ubuntu 22.04+ / Debian 12+); pango itself comes from the target system.
FROM --platform=linux/amd64 ubuntu:22.04 AS pango
ENV DEBIAN_FRONTEND=noninteractive UV_PYTHON_INSTALL_DIR=/opt/uvpy
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates build-essential pkg-config libpango1.0-dev \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
RUN uv python install 3.12 && uv venv --python 3.12 /w && uv pip install --python /w/bin/python pip \
 && /w/bin/python -m pip wheel --no-deps manimpango==0.7.1 -w /wheels && ls /wheels

FROM --platform=linux/amd64 node:20-bookworm AS prep
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl xz-utils binutils fakeroot dpkg rpm \
      libgl1 libegl1 libpangocairo-1.0-0 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

# ---- relocatable Python 3.12 + engine packages -------------------------------------------
ENV UV_PYTHON_INSTALL_DIR=/opt/uvpy UV_LINK_MODE=copy UV_COMPILE_BYTECODE=0
RUN uv python install 3.12 \
 && mkdir -p /bundle \
 && cp -a "$(dirname "$(dirname "$(uv python find 3.12)")")" /bundle/python \
 && rm -f /bundle/python/lib/python3.12/EXTERNALLY-MANAGED \
 && /bundle/python/bin/python3 --version
COPY packaging/linux/requirements.txt packaging/linux/constraints.txt /tmp/req/
COPY --from=pango /wheels /wheels
RUN uv pip install --python /bundle/python/bin/python3 --break-system-packages --no-build --find-links /wheels \
      -r /tmp/req/requirements.txt -c /tmp/req/constraints.txt
# static ffmpeg for exports (manimgl pipes frames into `ffmpeg` on PATH)
RUN uv pip install --target /tmp/ffm imageio-ffmpeg==0.6.0 \
 && cp /tmp/ffm/imageio_ffmpeg/binaries/ffmpeg-linux* /bundle/python/bin/ffmpeg \
 && chmod +x /bundle/python/bin/ffmpeg && /bundle/python/bin/ffmpeg -version | head -1 && rm -rf /tmp/ffm
# semantic search model (works offline)
RUN HF_HUB_DISABLE_TELEMETRY=1 /bundle/python/bin/python3 -c "from huggingface_hub import snapshot_download as d; \
d('BAAI/bge-small-en-v1.5', allow_patterns=['onnx/model.onnx','tokenizer.json','config.json'], local_dir='/bundle/models/bge-small-en-v1.5')" \
 && rm -rf /bundle/models/bge-small-en-v1.5/.cache
# trim: CPython's own test suite, pip caches, launcher scripts with baked-in build paths still work via `python -m`
RUN rm -rf /bundle/python/lib/python3.12/test /bundle/python/lib/python3.12/idlelib \
 && find /bundle/python -name '__pycache__' -prune -exec rm -rf {} + \
 && find /bundle/python -name '*.pyc' -delete

# ---- engine source -----------------------------------------------------------------------
COPY engine /bundle/engine
RUN rm -rf /bundle/engine/tests /bundle/engine/data /bundle/engine/videos /bundle/engine/imported_frames /bundle/engine/.venv \
 && /bundle/python/bin/python3 -m compileall -q -j0 --invalidation-mode unchecked-hash /bundle/python/lib /bundle/engine || true \
 && /bundle/python/bin/python3 -c "import sys; sys.path.insert(0,'/bundle/engine'); import manimpango, moderngl, onnxruntime, tokenizers, numpy, scipy, PIL, code_knobs, search; print('imports ok (display-free subset; the full app is tested under Xvfb by test.sh)')"

# ---- Electron app ------------------------------------------------------------------------
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY index.html vite.config.ts tsconfig.json ./
COPY src src
COPY electron electron
COPY packaging packaging
RUN npx vite build
RUN mkdir -p build-res && mv /bundle/engine /bundle/python /bundle/models build-res/

# one target per step: under x86 emulation, packaging both at once can exhaust Docker's memory.
# Each step writes its own latest-linux.yml (update info for the self-updater): merge them.
FROM prep AS build
RUN npx electron-builder --config packaging/linux/electron-builder.yml --linux AppImage --x64 --publish never \
 && mv release/latest-linux.yml /tmp/latest-appimage.yml
RUN npx electron-builder --config packaging/linux/electron-builder.yml --linux deb --x64 --publish never \
 && node packaging/linux/merge-latest.cjs /tmp/latest-appimage.yml release/latest-linux.yml release/latest-linux.yml

FROM scratch AS artifacts
COPY --from=build /app/release/MathStudio-x86_64.AppImage /app/release/MathStudio-amd64.deb /app/release/latest-linux.yml /

# Only for packaging/linux/test-update.sh: the same app with a higher version, so a real AppImage
# can update itself to it (and the differential download between two builds gets measured).
FROM build AS build-next
ARG NEXT_VERSION=99.0.0
RUN npx electron-builder --config packaging/linux/electron-builder.yml --linux AppImage --x64 --publish never \
      -c.extraMetadata.version=${NEXT_VERSION} -c.directories.output=release-next

FROM scratch AS artifacts-next
COPY --from=build-next /app/release-next/MathStudio-x86_64.AppImage /app/release-next/latest-linux.yml /
