FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./

RUN npm ci --only=production

COPY server/src/ ./src/
COPY client/build/ ./client/build/

EXPOSE 3000

CMD ["node", "src/index.js"]