FROM node:20-alpine AS builder
WORKDIR /app
COPY web-auth/package*.json ./
RUN npm ci
COPY web-auth/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY profile-srv/proto/profile/profile.proto /proto/profile/profile.proto
EXPOSE 4321
CMD ["node", "dist/server/entry.mjs"]
