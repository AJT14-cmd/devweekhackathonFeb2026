"""
MongoDB client and GridFS bucket for the backend.
Database stores meetings; GridFS stores audio files.
"""
import os
from pymongo import MongoClient
from gridfs import GridFS

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DB_NAME = os.getenv("MONGODB_DB_NAME", "meeting_transcription")

if not MONGODB_URI:
    raise RuntimeError("Missing MONGODB_URI in environment. Add it to backend/.env")

_client = None  # MongoClient


def get_client() -> MongoClient:
    global _client
    if _client is None:
        _client = MongoClient(MONGODB_URI)
    return _client


def get_db():
    return get_client()[DB_NAME]


def get_meetings_collection():
    return get_db()["meetings"]


def get_users_collection():
    return get_db()["users"]


def get_fs() -> GridFS:
    return GridFS(get_db(), collection="meeting_audio")
