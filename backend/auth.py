"""
JWT verification decorator for Flask routes.
Verifies Supabase-issued JWTs and attaches user_id to flask.g.
"""
import os
from functools import wraps

import jwt as pyjwt
from flask import request, jsonify, g

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")


def require_auth(f):
    """Decorator that verifies the Authorization: Bearer <token> header."""
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get("Authorization", "")
        if not auth_header.startswith("Bearer "):
            return jsonify({"error": "Missing or invalid Authorization header"}), 401

        token = auth_header.split(" ", 1)[1]

        if not SUPABASE_JWT_SECRET:
            return jsonify({"error": "Server misconfigured: JWT secret not set"}), 500

        try:
            payload = pyjwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                audience="authenticated",
            )
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
