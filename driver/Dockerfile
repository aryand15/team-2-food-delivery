FROM node:18-alpine

WORKDIR /app

COPY package.json package.json
RUN npm install

COPY driver.js driver.js

EXPOSE 3002

CMD ["npm", "start"]
