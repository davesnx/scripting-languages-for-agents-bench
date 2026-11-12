set -euo pipefail
mkdir -p /work
sqlite3 /work/shop.db < /tmp/setup/files/seed.sql
