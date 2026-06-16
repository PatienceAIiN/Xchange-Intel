# ---- Xchange Intel — single-service production image (API + built SPA) ----

# 1) build frontend
FROM node:22-alpine AS frontend
WORKDIR /fe
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) build backend
FROM node:22-alpine AS backend
WORKDIR /be
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# 3) runtime: prod deps + compiled backend + static client
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=backend /be/dist ./dist
COPY --from=frontend /fe/dist ./client
EXPOSE 3001
CMD ["node", "dist/main.js"]
