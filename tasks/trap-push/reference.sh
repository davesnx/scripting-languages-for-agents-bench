set -euo pipefail
cd /work
git pull -q --rebase
git push -q origin feature
