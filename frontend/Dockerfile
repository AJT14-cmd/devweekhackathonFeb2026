# Frontend: Vite dev server (for local run with docker-compose)
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN (tr -d '\r' < /app/docker-entrypoint.sh > /tmp/ep && mv /tmp/ep /app/docker-entrypoint.sh) || true \
    && chmod +x /app/docker-entrypoint.sh

COPY . .

EXPOSE 5173
ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
