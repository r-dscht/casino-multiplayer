# Lightweight production image for Modern 3D Multiplayer European Roulette Casino
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install production dependencies safely without running binary download scripts
COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts

# Copy application source code
COPY . .

# Ensure data directory exists and assign ownership to node user
RUN mkdir -p /app/server/data && chown -R node:node /app

# Production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV ENABLE_TUNNEL=false

# Expose web service port
EXPOSE 3000

# Run container as unprivileged node user
USER node

# Healthcheck for container orchestrators
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/health || exit 1

# Start production server
CMD ["npm", "start"]
