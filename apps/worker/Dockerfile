FROM node:22-bookworm-slim

ARG YT_DLP_VERSION=2026.07.04

RUN apt-get update \
  && apt-get install --yes --no-install-recommends \
    ca-certificates \
    ffmpeg \
    python3 \
    python3-venv \
    tini \
  && python3 -m venv /opt/yt-dlp \
  && /opt/yt-dlp/bin/pip install --no-cache-dir "yt-dlp==${YT_DLP_VERSION}" \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
  DATA_DIR=/var/lib/research-video \
  YT_DLP_PATH=/opt/yt-dlp/bin/yt-dlp \
  WORKER_MODE=continuous \
  WORKER_EXECUTION_LOCATION=hosted

WORKDIR /app
COPY package.json package-lock.json ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json tsconfig.base.json ./
RUN npm ci --include=dev \
  && npm run typecheck \
  && mkdir -p /var/lib/research-video \
  && chown -R node:node /var/lib/research-video

# Keep the speech engine swappable and the model out of the image. A deployment
# mounts a compatible whisper-cli plus its libraries and a read-only GGML model,
# then sets WHISPER_CPP_PATH and WHISPER_CPP_MODEL_PATH to those mount paths.
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "dev:worker"]
