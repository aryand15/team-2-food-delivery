FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache curl

COPY package*.json ./
RUN npm install

COPY worker.js worker.js

EXPOSE 8082

CMD ["npm", "start"]