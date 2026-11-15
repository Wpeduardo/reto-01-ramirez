FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --production --frozen-lockfile || bun install --production
COPY agent ./agent
COPY src ./src
COPY web ./web
COPY fixtures ./fixtures
ENV PORT=3000
EXPOSE 3000
RUN mkdir -p /app/out && chown -R bun:bun /app/out
USER bun
CMD ["bun", "src/server.ts"]
