FROM node:18-alpine

WORKDIR /app

COPY package.json package.json
RUN apk add --no-cache curl
RUN npm install

COPY driver.js driver.js

EXPOSE 3002

CMD ["npm", "start"]