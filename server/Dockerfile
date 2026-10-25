FROM node:22.18-bookworm-slim AS base

WORKDIR /app

FROM base AS build

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN DATABASE_URL=build-only npm run build

FROM build AS migrations

ENV NODE_ENV=production

CMD ["npm", "run", "db:deploy"]

FROM base AS production-dependencies

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM base AS runtime

ENV NODE_ENV=production
ENV PORT=5000

COPY package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/generated ./generated
COPY --from=build /app/index.js /app/auth.js /app/config.js ./

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["npm", "start"]
