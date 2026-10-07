# Stream proxy ของคลื่นไทย — build: docker build -t khlun-thai-proxy server/
# ใช้ Node 24 LTS (docs/PROXY.md ข้อ 8) เปลี่ยนได้ด้วย --build-arg NODE_VERSION=22
ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:${NODE_VERSION}-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/healthz || exit 1
STOPSIGNAL SIGTERM
CMD ["node", "src/index.js"]
