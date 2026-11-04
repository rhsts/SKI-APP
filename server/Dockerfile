# Runs on a Raspberry Pi 4/5 (arm64) as well as on a normal PC.
FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json index.js docker-entrypoint.sh ./
COPY src ./src
ENV NODE_ENV=production PORT=8787 DB_FILE=/data/ski-friends.db
VOLUME /data
EXPOSE 8787
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
