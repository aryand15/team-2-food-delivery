FROM node:18-alpine

WORKDIR /app

COPY package.json package.json
RUN apk add --no-cache curl
RUN npm install

COPY notification.js notification.js

EXPOSE 8080

CMD ["npm", "start"]
