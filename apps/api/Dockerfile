# Multi-stage: the runtime image carries no toolchain and no source.
FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

FROM base AS build
# Manifests first so a source-only change reuses the install layer.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @agentos/shared run build \
 && pnpm --filter @agentos/db run build \
 && pnpm --filter @agentos/api run build

# `pnpm deploy` flattens the workspace into a self-contained directory with a
# real node_modules. Copying pnpm's store into a scratch image does not work —
# its symlinks point outside whatever you copied.
RUN pnpm --filter @agentos/api deploy --prod --legacy /out \
 && cp -r packages/db/dist /out/node_modules/@agentos/db/dist \
 && cp -r packages/db/migrations /out/node_modules/@agentos/db/migrations \
 && cp -r packages/shared/dist /out/node_modules/@agentos/shared/dist

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /out ./

# Never run the control plane as root: it holds every credential in the system.
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations run before the process serves traffic, so a deploy can never
# leave the schema behind the code.
CMD ["sh", "-c", "node node_modules/@agentos/db/dist/migrate.js && node dist/main.js"]
