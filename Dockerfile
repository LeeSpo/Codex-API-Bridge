FROM docker.io/library/node:22-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

ENV NODE_ENV=production \
    PORT=8088 \
    DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 8088

ENTRYPOINT ["node", "src/cli.js"]
CMD ["server"]
