FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=4103
EXPOSE 4103
CMD ["node", "dist/index.js"]
