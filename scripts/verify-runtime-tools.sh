#!/bin/sh
set -eu

node - <<'NODE'
const [major] = process.versions.node.split('.').map(Number);
if (major !== 24) {
  console.error(`Node 24.x is required; found ${process.version}.`);
  process.exit(1);
}
console.log(`Node runtime: ${process.version}`);
NODE

for tool in ffmpeg ffprobe docker; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Required runtime tool is unavailable: $tool" >&2
    exit 1
  fi
done

ffmpeg -version | sed -n '1p'
ffprobe -version | sed -n '1p'
docker compose version
