#!/bin/sh
set -eu

case "${MINIO_USE_SSL:-false}" in
  true) minio_scheme=https ;;
  false) minio_scheme=http ;;
  *)
    echo 'MINIO_USE_SSL must be either true or false' >&2
    exit 1
    ;;
esac

mc alias set posts-media \
  "${minio_scheme}://${MINIO_ENDPOINT}:${MINIO_PORT}" \
  "${MINIO_ACCESS_KEY}" \
  "${MINIO_SECRET_KEY}"

for bucket in \
  "${MINIO_ORIGINALS_BUCKET}" \
  "${MINIO_PROCESSED_BUCKET}" \
  "${MINIO_TEMP_BUCKET}"; do
  mc mb --ignore-existing "posts-media/${bucket}"
  mc anonymous set none "posts-media/${bucket}"
done
