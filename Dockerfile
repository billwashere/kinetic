# syntax=docker/dockerfile:1.7
#
# Serves the built Kinetic Docs release (portal + knowledge explorer) over HTTP.
#
#   docker build -t kinetic-docs .
#   docker run --rm -p 8080:8080 kinetic-docs
#
# Host-repo docs content (kinetic.config.json, locales, guides, generated, public) is supplied as a
# named build context, never baked into this file:
#
#   docker build --build-context workspace=/path/to/host/docs -t kinetic-docs .
#
# See AGENTS.md, "Docker".

ARG NODE_VERSION=22
ARG PNPM_VERSION=10.33.0

# Default (empty) workspace. Overridden by `--build-context workspace=<dir>`.
FROM scratch AS workspace

# ---------------------------------------------------------------------------- build
FROM node:${NODE_VERSION}-alpine AS build
ARG PNPM_VERSION
# Path of the host config inside the workspace context. If the file is absent the build uses the
# repo's own content (Kinetic's sample knowledge/locales).
ARG KINETIC_CONFIG_FILE=/workspace/kinetic.config.json
# Docs version namespace (default in the engine: v1.0).
ARG DOCS_VERSION
ENV CI=true \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 \
    DOCS_VERSION=${DOCS_VERSION}
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /repo

# Dependency layer: manifests only, so source edits do not bust the install cache.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/docs-portal/package.json apps/docs-portal/
COPY packages/engine/package.json packages/engine/
COPY packages/renderer-compat/package.json packages/renderer-compat/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY apps apps
COPY packages packages
COPY --from=workspace / /workspace

# KINETIC_CONFIG is exported only when the host config exists (it must exist if the variable is set).
# Order: renderer-compat -> knowledge:compile (the portal reads dist/knowledge) -> astro build -> release:build.
RUN set -eu; \
    if [ -f "$KINETIC_CONFIG_FILE" ]; then export KINETIC_CONFIG="$KINETIC_CONFIG_FILE"; \
    else echo "No $KINETIC_CONFIG_FILE: building the repo's own content"; fi; \
    [ -n "${DOCS_VERSION}" ] || unset DOCS_VERSION; \
    pnpm --filter @kinetic/renderer-compat build; \
    pnpm --filter @kinetic/engine knowledge:compile; \
    pnpm --filter @kinetic/docs-portal exec astro build; \
    pnpm --filter @kinetic/engine release:build -- --no-media --declare-missing-media --site ../../apps/docs-portal/dist; \
    rel="$(node -p "require('/repo/packages/engine/dist/release/cdn/current.json').releaseId")"; \
    mkdir -p /out; \
    cp -r "/repo/packages/engine/dist/release/cdn/releases/$rel/." /out/; \
    cp /repo/packages/engine/src/knowledge/offline-serve.mjs /out/serve.mjs

# ---------------------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-alpine AS runtime
ENV PORT=8080 \
    BASE=/ \
    HOST=0.0.0.0 \
    NODE_ENV=production
WORKDIR /srv/docs
COPY --from=build --chown=node:node /out/ /srv/docs/
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD ["sh", "-c", "node -e \"fetch('http://127.0.0.1:'+process.env.PORT+process.env.BASE).then(r=>process.exit(r.ok?0:1),()=>process.exit(1))\""]
# exec form via sh so PORT/BASE/HOST are read at run time.
CMD ["sh", "-c", "exec node serve.mjs --host \"$HOST\" --port \"$PORT\" --base \"$BASE\""]
