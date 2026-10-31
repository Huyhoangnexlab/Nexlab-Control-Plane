# Control Plane — image chạy production (Next.js standalone). Build:  docker build -t nexlab-control-plane:demo .
# Không chứa bí mật: khoá ký, DATABASE_URL... truyền qua biến môi trường lúc chạy (deploy/docker-compose.prod.yml).
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-alpine AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/docs ./docs
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD wget -qO- http://127.0.0.1:3000/healthz || exit 1
CMD ["node", "server.js"]
