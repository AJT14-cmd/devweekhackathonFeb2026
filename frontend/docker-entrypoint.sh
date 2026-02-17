#!/bin/sh
# Create .env from container environment (set by docker-compose from the YAML).
set -e
cat << EOF > /app/.env
# Auto-generated from docker-compose environment
VITE_API_URL=${VITE_API_URL:-http://localhost:5000}
VITE_SOCKET_URL=${VITE_SOCKET_URL:-http://localhost:5000}
EOF
exec "$@"
