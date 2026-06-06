# ==========================================
# STAGE 1: BUILDER
# ==========================================
FROM node:20-alpine AS builder

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

# ==========================================
# STAGE 2: RUNNER
# ==========================================
FROM node:20-alpine AS runner

WORKDIR /app

# Set production environment
ENV NODE_ENV=production

# Copy package descriptors
COPY package*.json ./

# Install only production dependencies (ignore scripts to avoid rebuilding frontend)
RUN npm install --omit=dev --ignore-scripts

# Copy compiled backend and built frontend from builder stage
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/frontend/dist ./frontend/dist

# Expose port
EXPOSE 3000

# Native healthcheck using node fetch (supported in Node 18+)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/api/status').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"

# Start the server
CMD ["node", "dist/backend/server.js"]
