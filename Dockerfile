ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; npm ci
COPY tsconfig.json ./
COPY src ./src
COPY shared ./shared
RUN npm run build

FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev && npx playwright install --with-deps chromium && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY public ./public
COPY shared ./shared
COPY plugin ./plugin
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data BROWSER_HEADLESS=true
RUN mkdir /data
EXPOSE 3000
VOLUME /data
CMD ["node", "dist/server.js"]
