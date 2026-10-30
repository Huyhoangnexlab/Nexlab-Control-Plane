/**
 * Lược đồ Postgres. Mỗi phần tử là MỘT migration, chạy đúng một lần theo thứ tự (bảng schema_migrations).
 * Chỉ THÊM migration mới ở cuối; không sửa migration đã chạy.
 */
export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  {
    version: 1,
    name: "khoi-tao",
    sql: `
CREATE TABLE tenants (
  id                    text PRIMARY KEY,
  name                  text NOT NULL,
  slug                  text NOT NULL UNIQUE,
  domain                text NOT NULL UNIQUE,
  status                text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  policy_version        integer NOT NULL DEFAULT 1,
  entitlement_ttl_hours integer NOT NULL DEFAULT 24 CHECK (entitlement_ttl_hours BETWEEN 1 AND 168),
  product_name          text,
  accent                text,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id            text PRIMARY KEY,
  tenant_id     text REFERENCES tenants(id) ON DELETE CASCADE,
  email         text NOT NULL,
  display_name  text NOT NULL,
  password_hash text NOT NULL,
  admin_role    text NOT NULL DEFAULT 'none' CHECK (admin_role IN ('none','tenant_admin','platform_admin')),
  hub_role      text NOT NULL DEFAULT 'member' CHECK (hub_role IN ('viewer','member','lead','admin')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  seeded        boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  -- platform_admin không thuộc tenant nào; mọi người khác phải thuộc đúng một tenant.
  CHECK ((admin_role = 'platform_admin') = (tenant_id IS NULL))
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email));
CREATE INDEX users_tenant_idx ON users (tenant_id);

CREATE TABLE departments (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text NOT NULL DEFAULT '',
  manager_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE TABLE memberships (
  user_id       text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  department_id text NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  source        text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','idp')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, department_id)
);
CREATE INDEX memberships_dept_idx ON memberships (department_id);

CREATE TABLE catalog_apps (
  id         text PRIMARY KEY,
  tenant_id  text NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       text NOT NULL,
  origin     text NOT NULL,
  icon       text NOT NULL DEFAULT 'Globe',
  color      text NOT NULL DEFAULT '#4f46e5',
  tags       text[] NOT NULL DEFAULT '{}',
  max_level  text NOT NULL DEFAULT 'M1' CHECK (max_level IN ('none','open','ask','M0','M1','M2','M3')),
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, origin)
);

CREATE TABLE department_apps (
  department_id text NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  app_id        text NOT NULL REFERENCES catalog_apps(id) ON DELETE CASCADE,
  level         text NOT NULL CHECK (level IN ('open','ask','M0','M1','M2','M3')),
  updated_by    text,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, app_id)
);

CREATE TABLE sessions (
  id         text PRIMARY KEY,           -- sha256 của token trong cookie (không lưu token thô)
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- Nhật ký chỉ-thêm. Không có khoá ngoại để xoá tenant/người dùng không làm mất dấu vết.
CREATE TABLE audit_log (
  id            bigserial PRIMARY KEY,
  ts            timestamptz NOT NULL DEFAULT now(),
  tenant_id     text,
  dept_id       text,
  actor_user_id text,
  actor_email   text NOT NULL,
  action        text NOT NULL,
  target_type   text NOT NULL,
  target_id     text,
  summary       text NOT NULL,
  before        jsonb,
  after         jsonb
);
CREATE INDEX audit_tenant_ts_idx ON audit_log (tenant_id, ts DESC);
CREATE INDEX audit_dept_ts_idx ON audit_log (dept_id, ts DESC);

CREATE FUNCTION cp_audit_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_log chỉ được thêm, không sửa/xoá';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_update BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION cp_audit_append_only();
CREATE TRIGGER audit_log_no_truncate BEFORE TRUNCATE ON audit_log
  FOR EACH STATEMENT EXECUTE FUNCTION cp_audit_append_only();

-- Lớp phòng thủ thứ hai (ngoài lớp dịch vụ): không cho dữ liệu «chéo tenant» lọt vào DB.
CREATE FUNCTION cp_check_membership_tenant() RETURNS trigger AS $$
DECLARE u_tenant text; d_tenant text;
BEGIN
  SELECT tenant_id INTO u_tenant FROM users WHERE id = NEW.user_id;
  SELECT tenant_id INTO d_tenant FROM departments WHERE id = NEW.department_id;
  IF u_tenant IS DISTINCT FROM d_tenant THEN
    RAISE EXCEPTION 'người dùng và phòng ban khác tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER memberships_same_tenant BEFORE INSERT OR UPDATE ON memberships
  FOR EACH ROW EXECUTE FUNCTION cp_check_membership_tenant();

CREATE FUNCTION cp_check_dept_app_tenant() RETURNS trigger AS $$
DECLARE d_tenant text; a_tenant text; a_max text;
BEGIN
  SELECT tenant_id INTO d_tenant FROM departments WHERE id = NEW.department_id;
  SELECT tenant_id, max_level INTO a_tenant, a_max FROM catalog_apps WHERE id = NEW.app_id;
  IF d_tenant IS DISTINCT FROM a_tenant THEN
    RAISE EXCEPTION 'phòng ban và app khác tenant';
  END IF;
  IF array_position(ARRAY['none','open','ask','M0','M1','M2','M3'], NEW.level)
     > array_position(ARRAY['none','open','ask','M0','M1','M2','M3'], a_max) THEN
    RAISE EXCEPTION 'mức % vượt trần % của app', NEW.level, a_max;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER department_apps_guard BEFORE INSERT OR UPDATE ON department_apps
  FOR EACH ROW EXECUTE FUNCTION cp_check_dept_app_tenant();

CREATE FUNCTION cp_check_manager() RETURNS trigger AS $$
DECLARE u_tenant text;
BEGIN
  IF NEW.manager_user_id IS NOT NULL THEN
    SELECT tenant_id INTO u_tenant FROM users WHERE id = NEW.manager_user_id;
    IF u_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'trưởng phòng phải thuộc cùng tenant';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER departments_manager_same_tenant BEFORE INSERT OR UPDATE ON departments
  FOR EACH ROW EXECUTE FUNCTION cp_check_manager();
`,
  },
  {
    version: 2,
    name: "token-hub-va-thiet-bi",
    sql: `
-- Phiên có hai loại: 'console' (cookie của Admin Console) và 'hub' (bearer token cho ứng dụng Hub).
ALTER TABLE sessions ADD COLUMN kind text NOT NULL DEFAULT 'console' CHECK (kind IN ('console','hub'));
ALTER TABLE sessions ADD COLUMN device_id text;

-- Thiết bị của người dùng (do Hub tự sinh id lúc cài). Gói quyền gắn với (người dùng, thiết bị) và thu hồi được theo thiết bị.
CREATE TABLE devices (
  user_id    text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id         text NOT NULL,
  name       text NOT NULL DEFAULT '',
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen  timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  PRIMARY KEY (user_id, id)
);
`,
  },
  {
    version: 3,
    name: "sso-oidc",
    sql: `
-- Nhà cung cấp danh tính (IdP) của tenant. Mỗi tenant tối đa MỘT IdP; chỉ quản trị nền tảng được khai báo
-- (tin một issuer = tin mọi token nó ký cho tenant này, và server sẽ tải JWKS từ địa chỉ đó).
CREATE TABLE identity_providers (
  tenant_id        text PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  issuer           text NOT NULL UNIQUE,
  client_id        text NOT NULL,
  groups_claim     text NOT NULL DEFAULT 'groups',
  sync_groups      boolean NOT NULL DEFAULT true,
  jit_provisioning boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Liên kết tài khoản Control Plane với danh tính ở IdP: (issuer, sub) là định danh ổn định, email chỉ dùng để liên kết lần đầu.
ALTER TABLE users ADD COLUMN idp_issuer text;
ALTER TABLE users ADD COLUMN idp_sub text;
CREATE UNIQUE INDEX users_idp_uq ON users (idp_issuer, idp_sub) WHERE idp_sub IS NOT NULL;

-- Tên nhóm ở IdP tương ứng với phòng ban (thành viên phòng đến từ IdP, không phải từ trưởng phòng).
ALTER TABLE departments ADD COLUMN idp_group text;
CREATE UNIQUE INDEX departments_idp_group_uq ON departments (tenant_id, lower(idp_group)) WHERE idp_group IS NOT NULL;
`,
  },
];
