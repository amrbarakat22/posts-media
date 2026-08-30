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

## Fix round 1: root startup wiring and barrel compatibility

### Confirmed causes and correction

The first implementation registered `ConfigurationModule` but neither root
module imported it. Consequently the service was never instantiated, the API
read raw `process.env.PORT`, and the worker had no configuration startup path.
The configuration barrel also replaced the original `libraryName` export.

`ApiModule` and `WorkerModule` now import `ConfigurationModule`. Both root
bootstraps are exported for integration testing while retaining their
`require.main === module` production entrypoints. API bootstrap gets
`EnvironmentConfigurationService`, sets the validated API prefix, and listens
on the validated typed port; it no longer reads `process.env` directly.
`libraryName = 'configuration'` is restored alongside the new exports.

### Fix-round RED evidence

The tests were written before the wiring change:

```text
$ npm run test:unit -- --runTestsByPath apps/api/src/api.module.spec.ts
FAIL rejects invalid environment: Received promise resolved instead of rejected
FAIL typed API config: EnvironmentConfigurationService provider does not exist

$ npm run test:worker -- --runTestsByPath apps/worker/src/worker.module.spec.ts
FAIL rejects invalid environment: Received promise resolved instead of rejected
FAIL typed worker config: EnvironmentConfigurationService provider does not exist

$ npm run test:unit -- --runTestsByPath apps/api/src/main.spec.ts
FAIL TS2459: Module './main' declares 'bootstrap' locally, but it is not exported
```

The worker bootstrap test produced the same `TS2459` failure. During the first
GREEN attempt, Nest's default initialization behavior called `process.exit(1)`
for the intentionally invalid environment. That is expected production fatal
behavior; the test-only bootstrap options now use Nest's real
`abortOnError: false` to observe the rejected startup promise without mocking
the application or validation service.

### Fix-round GREEN and regression evidence

```text
PASS npm run test:unit -- --runInBand
     Test Suites: 5 passed, 5 total; Tests: 21 passed, 21 total
PASS npm run test:worker
     Test Suites: 2 passed, 2 total; Tests: 4 passed, 4 total
PASS npm run build
PASS npm run lint
PASS npm run format:check
PASS docker compose config --quiet
PASS docker compose -f docker-compose.test.yml config --quiet
PASS git diff --check
```

The new API and worker tests create real Nest testing modules and application
contexts. They prove an unsupported `NODE_ENV` rejects module creation and
bootstrap, valid environment values are injected through the real typed
configuration service, and API binds an ephemeral validated configured port.
The full unit run includes the neighboring Task 1 public-barrel smoke test
(`libs/domain/src/index.spec.ts`), which now passes with the restored export.
