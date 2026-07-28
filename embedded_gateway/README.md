# Embedded ChatGPT image gateway

This folder vendors the image-only runtime used by the Windows desktop build.
The bundled process:

- binds only to `127.0.0.1`;
- exposes health, session-bridge, and image-task routes only;
- receives a random API key and bridge secret from the parent app at startup;
- exits when the parent Langbai process exits;
- stores resumable task state below the current user's application-data folder.

It is an unofficial compatibility layer for a user-provided ChatGPT web
session. It is not the OpenAI Image API and does not guarantee that an account
has image-generation entitlement.
