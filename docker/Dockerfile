# Multi-stage build for production.
FROM node:22-alpine AS base

# All dependencies: the builder needs dev dependencies (mastra CLI, TypeScript).
FROM base AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --legacy-peer-deps

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Production image
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production PORT=4111 HOST=0.0.0.0

RUN addgroup --g 1001 --system app && \
    adduser --u 1001 --system --ingroup app app

COPY --from=builder --chown=app:app /app/.mastra/output/package.json /app/.mastra/output/.npmrc* ./
RUN npm install --omit=dev --legacy-peer-deps
COPY --from=builder --chown=app:app /app/.mastra/output/ .

USER app

EXPOSE 4111

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4111/health',(r)=>{process.exit(r.statusCode===200?0:1)})"

CMD ["node", "index.mjs"]
