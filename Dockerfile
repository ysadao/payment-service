FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
COPY prisma ./prisma
COPY web/package.json ./web/package.json
RUN npm install && npm install --prefix web
COPY . .
RUN npx prisma generate && npm run build --prefix web && npx tsc
ENV NODE_ENV=production PORT=3103 DEMO_EXPOSE_TOKENS=false
EXPOSE 3103
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
