FROM node:24.19.0-bookworm-slim

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.js calendar-history.js ./
RUN mkdir -p /data && chown node:node /data

ENV HOST=0.0.0.0 \
    PORT=17082 \
    ATLAS_POWERWALL_DATA_DIR=/data

USER node
EXPOSE 17082
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:17082/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
