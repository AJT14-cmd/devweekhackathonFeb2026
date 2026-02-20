#!/bin/sh
# Write .env from container environment (set by docker-compose from root .env).
# Values are quoted so Atlas URIs with # or & are not broken by the shell.
printf '%s\n' \
  "# Auto-generated from docker-compose environment (root .env)" \
  "DEEPGRAM_API_KEY=${DEEPGRAM_API_KEY:-}" \
  "SECRET_KEY=${SECRET_KEY:-dev-secret-change-in-production}" \
  "JWT_SECRET=${JWT_SECRET:-}" \
  "MONGODB_URI=${MONGODB_URI:-mongodb://127.0.0.1:27017}" \
  "MONGODB_DB_NAME=${MONGODB_DB_NAME:-}" \
  "YOUCOM_API_KEY=${YOUCOM_API_KEY:-}" \
  "FOXIT_CLIENT_ID=${FOXIT_CLIENT_ID:-}" \
  "FOXIT_CLIENT_SECRET=${FOXIT_CLIENT_SECRET:-}" \
  "FOXIT_PDF_SERVICES_CLIENT_ID=${FOXIT_PDF_SERVICES_CLIENT_ID:-}" \
  "FOXIT_PDF_SERVICES_CLIENT_SECRET=${FOXIT_PDF_SERVICES_CLIENT_SECRET:-}" \
  "FOXIT_HOST=${FOXIT_HOST:-https://na1.fusion.foxit.com}" \
  > /app/.env
exec "$@"
