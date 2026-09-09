#!/usr/bin/env sh
# Download the MaxMind GeoLite2 City database (task 3.2, design D6).
#
# The DB is bundled into the container image at build time so geolocation is a
# local file lookup with no runtime network call and no third-party IP transfer.
# It is NEVER committed to the repo (see .gitignore).
#
# Requires a free MaxMind account + license key:
#   https://www.maxmind.com/en/geolite2/signup
# Pass it as MAXMIND_LICENSE_KEY (build arg / env var).

set -eu

OUT_DIR="${1:-geodata}"
DB_NAME="GeoLite2-City"

if [ -z "${MAXMIND_LICENSE_KEY:-}" ]; then
  echo "ERROR: MAXMIND_LICENSE_KEY is not set." >&2
  echo "Get a free key at https://www.maxmind.com/en/geolite2/signup" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"

URL="https://download.maxmind.com/app/geoip_download?edition_id=${DB_NAME}&license_key=${MAXMIND_LICENSE_KEY}&suffix=tar.gz"

echo "Downloading ${DB_NAME}..."
curl -fsSL "$URL" -o "$OUT_DIR/${DB_NAME}.tar.gz"

echo "Extracting..."
# The tarball extracts to a dated directory; pull the .mmdb out of it.
tar -xzf "$OUT_DIR/${DB_NAME}.tar.gz" -C "$OUT_DIR"
FOUND="$(find "$OUT_DIR" -name "${DB_NAME}.mmdb" | head -n 1)"
if [ -z "$FOUND" ]; then
  echo "ERROR: ${DB_NAME}.mmdb not found after extraction." >&2
  exit 1
fi
mv "$FOUND" "$OUT_DIR/${DB_NAME}.mmdb"

# Clean up the extracted directory and tarball.
rm -f "$OUT_DIR/${DB_NAME}.tar.gz"
find "$OUT_DIR" -type d -name "${DB_NAME}_*" -exec rm -rf {} + 2>/dev/null || true

echo "Done: $OUT_DIR/${DB_NAME}.mmdb"
