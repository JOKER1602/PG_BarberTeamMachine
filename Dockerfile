# Imagen única: compila el frontend y lo sirve desde la API (SERVE_FRONTEND).
# Railway la detecta sola. Con un volumen montado, Railway pide RAILWAY_RUN_UID=0
# porque esta imagen corre como usuario sin privilegios (node). Pre-deploy:
#   node /app/scripts/migrate.mjs
# Uso: docker build -t reservas . && docker run --env-file backend/.env -p 3000:3000 -v reservas-uploads:/data/uploads reservas
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace frontend && npm prune --omit=dev

FROM node:24-slim
ENV NODE_ENV=production SERVE_FRONTEND=true UPLOADS_DIR=/data/uploads PORT=3000
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/backend ./backend
COPY --from=build /app/frontend/dist ./frontend/dist
COPY --from=build /app/database ./database
COPY --from=build /app/scripts ./scripts
RUN mkdir -p /data/uploads && chown -R node:node /data
USER node
WORKDIR /app/backend
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# node directamente (no npm) para recibir SIGTERM y cerrar de forma ordenada.
CMD ["node", "src/server.js"]
