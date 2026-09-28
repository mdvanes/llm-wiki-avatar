# Build from the repo root: docker build -f frontend/Dockerfile .
FROM node:24-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
COPY agent/package.json agent/
COPY frontend/package.json frontend/
RUN npm ci -w frontend --no-audit --no-fund

COPY frontend frontend
# Uses a local public/avatars/mpfb.glb if present, otherwise downloads the CC0 sample avatar.
RUN npm run fetch-avatar -w frontend && npm run build -w frontend

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public

USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
