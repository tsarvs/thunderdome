FROM node:25-alpine
WORKDIR /app
COPY package.json package-lock.json ./
COPY vendor ./vendor
RUN npm ci --omit=dev
COPY index.mjs ./
ENTRYPOINT ["node", "index.mjs"]
