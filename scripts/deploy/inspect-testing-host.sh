#!/usr/bin/env bash
set -Eeuo pipefail
set +x

# Read metadata only. Never source runtime environment files or print health bodies.
printf 'disk\n'
df -h / /opt/aoa
printf 'current_release\n'
readlink -f /opt/aoa/current || true
printf 'containers\n'
docker ps --filter name=aoa --format '{{.Names}} {{.Image}} {{.Status}}'
printf 'server_image_revision\n'
docker inspect --format '{{.Config.Image}} {{index .Config.Labels "org.opencontainers.image.revision"}} {{.State.Status}}' aoa-server-1
printf 'backup_file_metadata_only\n'
find /opt/aoa -maxdepth 3 -type f \( -name '*snapshot*.sql*' -o -name '*backup*.sql*' \) \
  -printf '%f %s bytes %TY-%Tm-%TdT%TH:%TM\n'
printf 'postgres_version_and_migration_count\n'
docker exec aoa-db-1 psql -X -U paperclip -d paperclip -v ON_ERROR_STOP=1 -Atc \
  "SELECT current_setting('server_version'); SELECT count(*) FROM drizzle.__drizzle_migrations;"
printf 'local_health_http_status\n'
curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' \
  http://127.0.0.1:3100/api/health
printf '\npublic_health_http_status\n'
curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' \
  https://testing.armyofagents.org/api/health
printf '\n'
