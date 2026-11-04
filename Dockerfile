# Lightweight production image for Modern 3D Multiplayer European Roulette Casino
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source code
COPY . .

# Production environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV ENABLE_TUNNEL=false

# Expose web service port
EXPOSE 3000

# Run container as unprivileged node user
USER node

# Start production server
CMD ["npm", "start"]
