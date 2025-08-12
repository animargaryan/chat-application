# 1) Dependencies layer
FROM node:20-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev

# 2) Runtime layer
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app

# Copy node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy service source
COPY worker-service ./worker-service
COPY schema.js ./schema.js
COPY .env ./.env

CMD ["node", "worker-service/worker.js"] 