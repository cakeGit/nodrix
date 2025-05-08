# Builder stage
FROM node:16-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --production

COPY . .

CMD ["node", "index.js"]