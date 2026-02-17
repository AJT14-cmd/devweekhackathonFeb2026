#!/bin/sh
# Create .env from container environment (set by docker-compose from the YAML).
cat << EOF > /app/.env
# Auto-generated from docker-compose environment
DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY:-}
SECRET_KEY=${SECRET_KEY:-dev-secret-change-in-production}
JWT_SECRET=${JWT_SECRET:-}
MONGODB_URI=${MONGODB_URI:-mongodb://mongo:27017}
MONGODB_DB_NAME=${MONGODB_DB_NAME:-}
EOF
exec "$@"
