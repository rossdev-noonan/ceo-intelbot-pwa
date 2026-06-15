# IntelBot-PWA production image — Next.js 16 standalone output.
# Target: Azure App Service (Linux container) or any Docker host running a
# long-lived `node server.js`. NOT serverless (see deployment plan).

# --- deps: install with a clean, reproducible lockfile install ---------------
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- build: compile the Next.js standalone server ----------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- run: minimal runtime with only the standalone output --------------------
FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
# Non-root runtime user.
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone server + static assets + public dir.
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Writable mount point for the SharePoint vault mirror + PDF cache. Mount a
# persistent volume here in production (SHAREPOINT_SYNC_DIR=/app/.vaultcache/sharepoint).
RUN mkdir -p /app/.vaultcache && chown -R nextjs:nodejs /app/.vaultcache
VOLUME /app/.vaultcache

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
