FROM node:24-bookworm-slim

RUN apt-get update \
    && apt-get install --yes --no-install-recommends chromium \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/headless-ci.mjs /app/headless-ci.mjs
ENV CHROMIUM_PATH=/usr/bin/chromium
USER node
ENTRYPOINT ["node", "/app/headless-ci.mjs"]
