.PHONY: dev up down migrate seed bootstrap-admin lint typecheck test build docker-build docker-build-migrator admin-up admin-down admin-status

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

ADMIN_STANDALONE := apps/admin/.next/standalone/apps/admin
ADMIN_PIDFILE := /tmp/zts-admin-3100.pid
ADMIN_LOG := /tmp/zts-admin-3100.log
ADMIN_PORT := 3100

## Daemonize standalone admin on :3100 (survives ephemeral agent shells). Requires prior `make build`.
admin-up:
	@if [ ! -f "$(ADMIN_STANDALONE)/server.js" ]; then \
		echo "error: missing $(ADMIN_STANDALONE)/server.js — run \`make build\` first"; \
		exit 1; \
	fi
	@mkdir -p "$(ADMIN_STANDALONE)/.next"
	@ln -sfn "$(CURDIR)/apps/admin/public" "$(ADMIN_STANDALONE)/public"
	@ln -sfn "$(CURDIR)/apps/admin/.next/static" "$(ADMIN_STANDALONE)/.next/static"
	@if lsof -nP -iTCP:$(ADMIN_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "admin already listening on :$(ADMIN_PORT)"; \
		exit 0; \
	fi
	@bash -c 'set -euo pipefail; \
		cd "$(CURDIR)/$(ADMIN_STANDALONE)"; \
		set -a; \
		[ -f "$(CURDIR)/apps/admin/.env.local" ] && . "$(CURDIR)/apps/admin/.env.local"; \
		set +a; \
		export PORT="$(ADMIN_PORT)"; \
		# Double-fork so the node process is reparented and ignores SIGHUP from agent shells. \
		( \
			( \
				trap "" HUP; \
				exec node server.js >>"$(ADMIN_LOG)" 2>&1 \
			) </dev/null & \
			echo $$! >"$(ADMIN_PIDFILE)"; \
		) </dev/null >/dev/null 2>&1; \
		sleep 0.4; \
		if ! lsof -nP -iTCP:$(ADMIN_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
			echo "error: admin failed to bind :$(ADMIN_PORT) — see $(ADMIN_LOG)"; \
			exit 1; \
		fi; \
		echo "admin up PID $$(cat "$(ADMIN_PIDFILE)") on :$(ADMIN_PORT) (log $(ADMIN_LOG))"'

## Stop standalone admin (pidfile and/or :3100 listener)
admin-down:
	@if [ -f "$(ADMIN_PIDFILE)" ]; then \
		pid=$$(cat "$(ADMIN_PIDFILE)"); \
		kill "$$pid" 2>/dev/null || true; \
		rm -f "$(ADMIN_PIDFILE)"; \
		echo "signaled PID $$pid"; \
	fi
	@pids=$$(lsof -t -nP -iTCP:$(ADMIN_PORT) -sTCP:LISTEN 2>/dev/null || true); \
	if [ -n "$$pids" ]; then \
		kill $$pids 2>/dev/null || true; \
		echo "killed listener(s) on :$(ADMIN_PORT): $$pids"; \
	else \
		echo "admin not listening on :$(ADMIN_PORT)"; \
	fi
	@rm -f "$(ADMIN_PIDFILE)"

## Show :3100 listen state and /api/health
admin-status:
	@if lsof -nP -iTCP:$(ADMIN_PORT) -sTCP:LISTEN >/dev/null 2>&1; then \
		echo "listening: yes (:$(ADMIN_PORT))"; \
		lsof -nP -iTCP:$(ADMIN_PORT) -sTCP:LISTEN || true; \
		if [ -f "$(ADMIN_PIDFILE)" ]; then echo "pidfile: $$(cat "$(ADMIN_PIDFILE)") ($(ADMIN_PIDFILE))"; fi; \
	else \
		echo "listening: no (:$(ADMIN_PORT))"; \
	fi
	@curl -sS -o /tmp/zts-admin-health.out -w "health: /api/health -> HTTP %{http_code}\n" \
		"http://127.0.0.1:$(ADMIN_PORT)/api/health" \
		|| echo "health: unreachable"
