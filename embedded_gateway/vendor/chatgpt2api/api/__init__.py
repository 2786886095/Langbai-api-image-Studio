"""Image-only embedded gateway package.

The desktop sidecar imports only the explicitly selected routers. Keeping this
module free of the full administrative app prevents text, account-admin, and
web-dashboard routes from being initialized or packaged by accident.
"""
