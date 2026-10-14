# Security and privacy

Report suspected vulnerabilities through this repository's private security reporting option when available. Do not post credentials, private recordings, transcripts or profile archives in public issues. For a non-sensitive report, describe the issue with a synthetic example.

Supported code is the latest Windows release. Sayo stores your own Groq key encrypted through Electron safeStorage on Windows, in `%USERPROFILE%/.sayo/groq-key.enc`. The corresponding Windows encryption profile and all user data must stay private. A cleared password field after saving is intentional; the renderer receives only a configured/not-configured state.

Source builds and default tests do not require credentials. The main process sends a key only as HTTPS authentication to fixed Groq endpoints, with redirects rejected. Groq receives audio for recognition and text for enabled cleanup; Sayo does not host a backend or collect telemetry.

Never commit or upload `.sayo`, `.env`, encrypted key/profile files, pending audio or real transcripts. Ignore rules and the publication scanner provide defense in depth; they cannot protect arbitrary manually uploaded files or every possible secret format. If a key is shared, revoke it with the provider and save a replacement.
