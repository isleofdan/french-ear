# French ear. No build step; the image is the source tree plus Node.
FROM node:22-slim

WORKDIR /app

# better-sqlite3 ships a prebuilt binary for this platform; the build tools
# are here only as the fallback if a prebuild is ever missing.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# The database lives on the mounted volume (/data, see fly.toml), never in
# the image. data/patterns.json is part of the image (/app/data), not the
# volume.
ENV DATA_DIR=/data
ENV PORT=8080
ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server.js"]
