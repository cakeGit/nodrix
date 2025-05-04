# # FROM node
# FROM node

# WORKDIR /app

# COPY . .

# RUN npm install

# CMD ["node", "index.js"]
FROM node:alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm install --production

COPY . .

CMD ["node", "index.js"]