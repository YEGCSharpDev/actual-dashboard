# ==========================================
# STAGE 1: BUILDER
# ==========================================
FROM node:20-alpine AS builder

# Install build dependencies for native C++ modules (like better-sqlite3 and sqlite3)
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy package descriptors
COPY package*.json ./
COPY frontend/package*.json ./frontend/

# Install dependencies for both backend and frontend
RUN npm install

# Copy source code
COPY backend ./backend
COPY frontend ./frontend

# Build both frontend and backend
RUN npm run build

# Remove development dependencies to keep final image minimal (maintaining native builds)
RUN npm prune --omit=dev

# ==========================================
# STAGE 2: RUNNER
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package descriptors
COPY package*.json ./

# Copy compiled backend, built frontend, and production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Expose port
EXPOSE 3000

# Native healthcheck using node fetch (supported in Node 18+)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/status').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the server
CMD ["node", "dist/backend/server.js"]
