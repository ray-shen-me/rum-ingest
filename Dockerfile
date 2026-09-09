# rum-ingest — Cloud Run service (ingest + metrics + rollup)
# Runs the TypeScript service directly via tsx (full ESM), which keeps the
# runtime free of ESM/CJS interop friction between isbot v5 (ESM) and
# firebase-admin (CJS). See design D15.

FROM node:22-slim AS base
WORKDIR /app

# --- Dependencies ---
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

# --- GeoLite2 City DB (task 3.2, design D6) ---
# Bundled at build time so geo is a local lookup — no runtime network call.
# Uses a BuildKit secret so the key is never stored in image layer metadata
# (unlike --build-arg which is visible in `docker history --no-trunc`).
# Build with: DOCKER_BUILDKIT=1 docker build --secret id=maxmind,env=MAXMIND_LICENSE_KEY .
FROM base AS geo
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY scripts/download-geolite2.sh ./scripts/download-geolite2.sh
RUN --mount=type=secret,id=maxmind,env=MAXMIND_LICENSE_KEY \
    sh scripts/download-geolite2.sh geodata

# --- Final image ---
FROM base AS run
ENV NODE_ENV=production
ENV PORT=8080
COPY --from=geo /app/geodata/GeoLite2-City.mmdb ./geodata/GeoLite2-City.mmdb
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
EXPOSE 8080
CMD ["npm", "run", "start"]
