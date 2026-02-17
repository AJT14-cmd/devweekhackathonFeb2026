"""
JWT verification for Flask routes.
Verifies backend-issued JWTs (HS256) and attaches user_id to flask.g.
"""
import os
from functools import wraps

import jwt as pyjwt
from flask import request, jsonify, g

JWT_SECRET = os.getenv("JWT_SECRET") or os.getenv("SECRET_KEY", "")
JWT_ALGORITHM = "HS256"


def _decode_jwt(token):
    """Verify our backend JWT and return payload (sub = user_id)."""
    if not JWT_SECRET:
        raise pyjwt.InvalidTokenError("Server misconfigured: JWT_SECRET or SECRET_KEY required")
    return pyjwt.decode(
        token,
        JWT_SECRET,
        algorithms=[JWT_ALGORITHM],
    )


def require_auth(f):
    """Decorator that verifies the Authorization: Bearer <token> header."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401

        token = auth_header.split(" ", 1)[1]

        try:
            payload = _decode_jwt(token)
        except pyjwt.ExpiredSignatureError:
            return jsonify({"error": "Token expired"}), 401
        except pyjwt.InvalidTokenError as e:
            return jsonify({"error": f"Invalid token: {e}"}), 401

        g.user_id = payload.get("sub")
        if not g.user_id:
            return jsonify({"error": "Token missing sub claim"}), 401

        return f(*args, **kwargs)

    return decorated
