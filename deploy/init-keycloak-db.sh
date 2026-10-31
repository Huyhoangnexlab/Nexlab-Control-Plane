#!/bin/sh
# Chạy một lần khi Postgres khởi tạo thư mục dữ liệu: tạo database + user riêng cho Keycloak.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE USER keycloak WITH PASSWORD '${KC_DB_PASSWORD}';
CREATE DATABASE keycloak OWNER keycloak;
SQL
