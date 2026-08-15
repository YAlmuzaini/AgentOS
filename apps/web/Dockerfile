# The web app is static once built; nginx serves it and nothing else.
FROM node:24-alpine AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @agentos/web...

COPY packages/shared packages/shared
COPY apps/web apps/web

# Baked in at build time, so the image is environment-specific by design.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @agentos/web run build

FROM nginx:1.29-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
