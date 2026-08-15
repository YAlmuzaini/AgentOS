# The VM-side worker (SPEC §16), packaged so it can run as its own user.
#
# The container boundary is the point. `DEPLOY.md` §6 requires this worker to
# run as a unix user of its own, because an agent with a shell can read the
# environment of any process sharing its user — running it here satisfies that
# requirement without asking you to hand-manage an account.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# git for repo mounts; ca-certificates so the proxy can reach Anthropic.
RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/local-runner/package.json apps/local-runner/
RUN pnpm install --frozen-lockfile --filter @agentos/local-runner...
COPY apps/local-runner apps/local-runner
RUN pnpm --filter @agentos/local-runner run build \
 && pnpm --filter @agentos/local-runner deploy --prod --legacy /out \
 && cp -r apps/local-runner/dist /out/dist

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /out ./

# Workspaces are created and destroyed here, and the node user must own it.
ENV LOCAL_RUNNER_WORK_ROOT=/var/lib/agentos-local
RUN mkdir -p /var/lib/agentos-local && chown -R node:node /var/lib/agentos-local

# Never root: this process holds a Claude credential and runs agent code.
USER node
EXPOSE 4600
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:4600/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
