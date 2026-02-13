# db/

This repo directory is intentionally kept light.

Databases are stored in the local Google Drive sync folder for durability:

`~/Library/CloudStorage/GoogleDrive-richducat@gmail.com/My Drive/OpenClaw Databases/`

Scripts should use that location (via env var `OPENCLAW_DB_ROOT`), not commit DB files to git.
