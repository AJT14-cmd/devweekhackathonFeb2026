"""
JWT verification decorator for Flask routes.
Verifies Supabase-issued JWTs (RS256 via JWKS or HS256 legacy) and attaches user_id to flask.g.
"""
import os
from functools import wraps

import jwt as pyjwt
from jwt import PyJWKClient
from flask import request, jsonify, g

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")


def _decode_jwt(token):
    """Verify JWT: try JWKS (RS256) first, fall back to HS256 with legacy secret."""
    # 1. Try JWKS (Supabase modern RS256 signing keys)
    if SUPABASE_URL:
        try:
            jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
            jwks_client = PyJWKClient(jwks_url)
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            return pyjwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience="authenticated",
            )
        except pyjwt.ExpiredSignatureError:
            raise
        except pyjwt.InvalidTokenError:
            raise
        except Exception:
            pass  # Fall through to HS256

    # 2. Fall back to legacy HS256 with JWT secret
    if SUPABASE_JWT_SECRET:
        return pyjwt.decode(
            token,
            SUPABASE_JWT_SECRET,
            algorithms=["HS256"],
            audience="authenticated",
        )

    raise pyjwt.InvalidTokenError("No valid verification method")


def require_auth(f):
    """Decorator that verifies the Authorization: Bearer <token> header."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401

        token = auth_header.split(" ", 1)[1]

        if not SUPABASE_URL and not SUPABASE_JWT_SECRET:
            return jsonify({"error": "Server misconfigured: SUPABASE_URL or SUPABASE_JWT_SECRET required"}), 500

        try:
            payload = _decode_jwt(token)
        except pyjwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except pyjwt.InvalidTokenError as e:
            return jsonify({"error": f"Invalid token: {e}"}), 401

        # Supabase puts the user id in the 'sub' claim
        g.user_id = payload.get("sub")
        if not g.user_id:
            return jsonify({"error": "Token missing sub claim"}), 401

        return f(*args, **kwargs)

    return decorated
