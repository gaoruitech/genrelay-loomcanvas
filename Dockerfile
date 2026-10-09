# Stage 1: build the web app
FROM node:20-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: server with the built web app
FROM node:20-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN apk add --no-cache dumb-init
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=web /web/dist /app/web-dist
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/app/bootstrap >/dev/null || exit 1
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "src/index.js"]
