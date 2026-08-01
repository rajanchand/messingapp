.PHONY: dev up down migrate seed bootstrap-admin lint typecheck test build docker-build docker-build-migrator

## Start local infrastructure (Postgres + Redis)
up:
	docker compose up -d

## Stop local infrastructure (volumes are preserved)
down:
	docker compose down

## Run the admin app in development mode
dev:
	pnpm --filter @zts/admin dev

## Apply database migrations
migrate:
	pnpm --filter @zts/database db:migrate

## Seed RBAC roles and permissions
seed:
	pnpm --filter @zts/database db:seed

## Create the first Super Admin account (interactive)
bootstrap-admin:
	pnpm bootstrap-admin

lint:
	pnpm lint

typecheck:
	pnpm typecheck

test:
	pnpm test

build:
	pnpm build

## Build the production Docker image
docker-build:
	docker build -t zts-admin:local .

## Build the migration-runner image
docker-build-migrator:
	docker build --target migrator -t zts-admin-migrator:local .
