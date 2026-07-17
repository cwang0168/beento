# Multi-stage build: compile TypeScript + generate the Prisma client in a
# full node image, then ship only the compiled output + prod deps in a slim
# runtime image. Cloud Run wants a small image with a fast cold start.

FROM node:20-slim AS build
WORKDIR /app

# Prisma's query engine needs libssl to be present to detect the right
# engine binary at generate/runtime -- node:20-slim doesn't ship it, and
# without it Prisma silently guesses a version, which can 500 at runtime.
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
RUN npx prisma generate

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The generated Prisma client lives in node_modules/.prisma + @prisma/client;
# npm ci --omit=dev already pulled @prisma/client, but the generated engine
# binaries only exist after `prisma generate`, so copy those over from the
# build stage rather than regenerating them here.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma

# Cloud Run sets PORT itself; config.ts falls back to 3000 for local use.
EXPOSE 3000

CMD ["node", "dist/index.js"]
