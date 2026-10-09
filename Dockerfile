# Stage 1: build the web app
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: production dependencies of the server
FROM node:20-alpine AS deps
WORKDIR /app
COPY server/package*.json ./
# The AWS SDK used for S3-compatible storage is a regular dependency, so it is installed here.
RUN npm ci --omit=dev

# Stage 3: the image that runs
FROM node:20-alpine
ENV NODE_ENV=production \
    PORT=3000 \
    WEB_DIST=/app/web-dist \
    STORAGE_LOCAL_DIR=/app/data/files
WORKDIR /app
# dumb-init is PID 1: it forwards SIGTERM to node, so `docker stop` gets a graceful shutdown.
RUN apk add --no-cache dumb-init && mkdir -p /app/data && chown node:node /app/data
# The code stays owned by root: the process (user "node") can read it and write only to /app/data.
COPY --from=deps /app/node_modules ./node_modules
COPY server/package.json ./
COPY server/src ./src
COPY --from=web /web/dist ./web-dist
COPY LICENSE THIRD_PARTY_NOTICES.md ./
USER node
VOLUME /app/data
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO /dev/null "http://127.0.0.1:${PORT}/api/app/bootstrap" || exit 1
STOPSIGNAL SIGTERM
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
