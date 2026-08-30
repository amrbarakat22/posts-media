# Task 2: Environment Validation and Docker Infrastructure

## Result

Implemented the typed environment contract and local Docker infrastructure on
`feat/posts-media-platform`, based on `55e6132971b18902af0e5f0905a915ad5e331954`.

## Test-first evidence

RED was run before `environment.schema.ts` existed:

```text
$ npm run test:unit -- --runTestsByPath libs/configuration/src/environment.schema.spec.ts
FAIL ... TS2307: Cannot find module './environment.schema'
Test Suites: 1 failed, 1 total
Tests:       0 total
```

GREEN after the implementation:

```text
PASS unit libs/configuration/src/environment.schema.spec.ts
Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

The tests cover a complete valid contract plus invalid/non-positive numeric
limits, omitted MinIO access/secret credentials, invalid worker concurrency,
invalid ports, job attempts below one, invalid processing lease renewal, and
unsupported processing profiles.

## Files added or changed

- `libs/configuration/src/environment.schema.ts`: strict typed parser and
  `EnvironmentValidationError`.
- `libs/configuration/src/configuration.module.ts` plus app, storage, queue,
  and processing config selectors; `libs/configuration/src/index.ts` exports
  the public interface.
- `libs/configuration/src/environment.schema.spec.ts`: focused unit tests.
- `.env.example`: full approved environment contract and `PROCESSING_PROFILE`.
- `docker-compose.yml`: exactly `postgres`, `redis`, `minio`, `minio-init`,
  `migrate`, `api`, and `worker`; named volumes and dependency health/order.
- `docker-compose.test.yml`: isolated PostgreSQL/Redis/MinIO test topology.
- `docker/api/Dockerfile` and `docker/worker/Dockerfile`: Node
  `24.15.0-bookworm-slim` multi-stage images with `ffmpeg`, `ca-certificates`,
  and `dumb-init`; API's image has no FFmpeg execution command.
- `docker/minio/initialize.sh`: idempotently creates and keeps private
  `post-originals`, `post-processed`, and `post-temporary` buckets.
- `scripts/verify-runtime-tools.sh` and the `verify:runtime` npm script.

## Image decisions

- PostgreSQL: `postgres:18.0-bookworm`.
- Redis: `redis:8.6.0-bookworm`.
- MinIO server: `minio/minio:RELEASE.2025-09-07T16-13-09Z`.
- MinIO client: `minio/mc:RELEASE.2025-08-13T08-35-41Z`.

The MinIO server tag was resolved on 2026-08-30 from the official MinIO Docker
Hub repository's newest published, non-`latest` server tag:
<https://hub.docker.com/r/minio/minio/tags> (the official API query used was
`https://hub.docker.com/v2/repositories/minio/minio/tags?page_size=25&ordering=last_updated`).
The API response listed that release tag as pushed on 2025-09-07. No `latest`
tag is used in either Compose file.

## Verification performed

```text
PASS  npm run test:unit -- --runTestsByPath libs/configuration/src/environment.schema.spec.ts
PASS  npm run build
PASS  npm run lint
PASS  npm run format:check
PASS  sh -n docker/minio/initialize.sh scripts/verify-runtime-tools.sh
PASS  docker compose config --quiet
PASS  docker compose -f docker-compose.test.yml config --quiet
PASS  git diff --check
```

The rendered normal Compose config contains only `127.0.0.1:3000`,
`127.0.0.1:9000`, and `127.0.0.1:9001` host bindings. PostgreSQL and Redis
have no published ports.

## Self-review

- All numeric values use base-10 safe integer parsing; ports are constrained to
  1 through 65535, required sizes/concurrency are positive, attempts are at
  least one, and lease renewal is strictly shorter than its lease.
- All buckets are private by default and explicitly reset to `none` anonymous
  access during idempotent initialization.
- One-shot migration waits for healthy PostgreSQL; API and worker wait for
  healthy database/Redis plus successful bucket initialization and migration.
- No unrelated tracked files were modified. `git diff --check` is clean.

## Concern / limitation

The host is Node `v18.19.1`, while the project intentionally requires Node 24.
`./scripts/verify-runtime-tools.sh` correctly exits with `Node 24.x is
required; found v18.19.1.` The source build/tests still passed under the host,
but this is not Node 24 runtime acceptance. Full `docker compose up` was not
claimed as green: the current base commit intentionally has no Prisma schema or
migrations yet, so the one-shot `migrate` service cannot complete until the
database task supplies them.
