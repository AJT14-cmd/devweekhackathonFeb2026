# Frontend: Vite dev server (for local run with docker-compose)
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .

# Expose Vite dev server; --host 0.0.0.0 so it's reachable from host
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
