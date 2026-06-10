# tests/fixtures/photos

Small synthetic JPEGs (1×1 px) used by the E2E suite to populate the upload
flow. They are deliberately the smallest valid JPEG payload we can ship
(~600 bytes each) so they do not bloat the repo.

If you need richer fixtures (e.g. for vision-model accuracy testing), add
them under `tests/fixtures/photos-rich/` and keep this directory for the
fast / smoke E2E path.
