FROM node:18-alpine

WORKDIR /app

COPY package.json package.json
RUN apk add --no-cache curl
RUN npm install

COPY worker.js worker.js

EXPOSE 8082

CMD ["npm", "start"]