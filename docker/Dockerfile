# Multi-stage build for production.
# Role-parameterized: MASTRA_OUTPUT=.mastra/output (API bundle, default) or
# .mastra/worker (worker bundle from `mastra worker build`). Both roles run the
# same entrypoint (index.mjs); the MASTRA_WORKERS env var selects the worker role.
FROM node:22-alpine AS base

# Install dependencies only when needed
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package*.json ./
RUN npm ci --only=production --legacy-peer-deps

# Build the application (API or worker artifact, per MASTRA_OUTPUT)
FROM base AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG MASTRA_OUTPUT=.mastra/output
RUN if [ "$MASTRA_OUTPUT" = ".mastra/worker" ]; \
    then npm run build:worker; else npm run build; fi

# Production image — same runner for both roles
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production PORT=4111 HOST=0.0.0.0

# Create non-root user
RUN addgroup --g 1001 --system app && \
    adduser --u 1001 --system --ingroup app app

ARG MASTRA_OUTPUT=.mastra/output
COPY --from=builder --chown=app:app /app/${MASTRA_OUTPUT}/package.json /app/${MASTRA_OUTPUT}/.npmrc* ./
RUN npm install --omit=dev --legacy-peer-deps
COPY --from=builder --chown=app:app /app/${MASTRA_OUTPUT}/ .

# Switch to non-root user
USER app

# Expose port
EXPOSE 4111

# /health is served by the worker artifact too (503 while startWorkers()
# initializes, 200 when ready), so one shape covers both roles.
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4111/health',(r)=>{process.exit(r.statusCode===200?0:1)})"

# The image no longer depends on the `mastra` CLI at runtime.
CMD ["node", "index.mjs"]
