FROM node:22-alpine AS builder
WORKDIR /app
RUN npm i -g pnpm@10.33.0 --registry https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --registry https://registry.npmmirror.com
COPY . .
RUN pnpm exec nest build notification

FROM node:22-alpine
WORKDIR /app
RUN npm i -g pnpm@10.33.0 --registry https://registry.npmmirror.com
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --registry https://registry.npmmirror.com
COPY --from=builder /app/dist/apps/notification ./dist/apps/notification
EXPOSE 3002
CMD ["node", "dist/apps/notification/main"]
