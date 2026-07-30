# syntax=docker/dockerfile:1
# Build with context = repository root:
#   docker build -f frontend/Dockerfile .

# ── Build SPA ────────────────────────────────────────────────────────────────
FROM node:20-alpine AS build

WORKDIR /app

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Empty = same-origin /api via the edge nginx proxy (required for httpOnly cookies).
ARG VITE_API_BASE=
ENV VITE_API_BASE=$VITE_API_BASE

RUN npm run build

# ── Serve SPA + reverse-proxy /api ───────────────────────────────────────────
FROM nginx:1.27-alpine

RUN rm -f /etc/nginx/conf.d/default.conf

COPY deploy/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

RUN mkdir -p /etc/nginx/certs

EXPOSE 80 443

# Plain HTTP health for the container probe (TLS is for external clients).
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1/healthz || exit 1
