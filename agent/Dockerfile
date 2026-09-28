# Build from the repo root: docker build -f agent/Dockerfile .
FROM node:24-slim

WORKDIR /app
ENV NODE_ENV=production

# Workspace manifests first for layer caching. The VAD and turn-detector weights ship inside
# @livekit/local-inference, so no model download step is needed.
COPY package.json package-lock.json ./
COPY agent/package.json agent/
COPY frontend/package.json frontend/
RUN npm ci -w agent --omit=dev --no-audit --no-fund && npm cache clean --force

COPY agent/src agent/src
COPY agent/scripts agent/scripts
COPY agent/tsconfig.json agent/
COPY vocab vocab
COPY sample-wiki sample-wiki

USER node
WORKDIR /app/agent
# Node 24 runs the TypeScript sources directly (type stripping).
CMD ["node", "src/main.ts", "start"]
