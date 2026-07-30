"""Shared pagination defaults for catalog / staff list endpoints."""

CATALOG_LIMIT_DEFAULT = 200
CATALOG_LIMIT_MAX = 500
# Manage UIs and catalog warm-loads request this many rows in one shot.
CATALOG_FETCH_LIMIT = CATALOG_LIMIT_MAX
