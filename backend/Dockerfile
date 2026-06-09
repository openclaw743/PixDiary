# syntax=docker/dockerfile:1.7

# ---------- Build stage ----------
FROM node:26-bookworm-slim AS build
WORKDIR /app

# Install deps with reproducible install
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

# ---------- Runtime stage ----------
FROM node:26-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000

# Non-root user
RUN groupadd --system --gid 10001 app \
 && useradd --system --uid 10001 --gid app --home /app --shell /usr/sbin/nologin app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/package.json ./package.json

USER app
EXPOSE 3000

# Liveness handled by Container Apps probe hitting /healthz
CMD ["node", "dist/index.js"]
