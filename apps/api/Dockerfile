FROM node:22-alpine AS builder
WORKDIR /app
RUN npm i -g pnpm@10.33.0 --registry https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --registry https://registry.npmmirror.com
COPY . .
RUN pnpm exec nest build api

FROM node:22-alpine
WORKDIR /app
RUN npm i -g pnpm@10.33.0 --registry https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --registry https://registry.npmmirror.com
COPY --from=builder /app/dist/apps/api ./dist/apps/api
COPY --from=builder /app/generated ./generated
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
EXPOSE 3000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/apps/api/main"]
