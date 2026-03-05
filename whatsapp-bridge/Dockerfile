FROM node:20-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production=false

COPY tsconfig.json ./
COPY src/ ./src/

RUN npx tsc

RUN npm prune --production

RUN mkdir -p /data/auth_info

EXPOSE 3001

CMD ["node", "dist/index.js"]
