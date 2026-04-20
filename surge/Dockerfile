FROM node:25-alpine
WORKDIR /app
COPY package*.json ./
RUN apk add --no-cache curl
RUN npm install
COPY . .
EXPOSE 3005
CMD ["npm", "start"]
