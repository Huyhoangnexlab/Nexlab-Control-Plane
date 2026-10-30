import type { AdminRole, HubRole } from "@/lib/validators";

/**
 * Dữ liệu mẫu DEV dùng chung cho: seed DB (`seed.ts`) và sinh realm Keycloak (`scripts/gen-keycloak-realms.ts`),
 * để tài khoản ở Control Plane và ở Keycloak luôn khớp nhau. Không import gì của server.
 */

/** Mật khẩu chung của mọi tài khoản mẫu (cả Control Plane lẫn Keycloak). Chỉ dùng trên máy dev. */
export const DEV_PASSWORD = "Nexlab@2026";

export const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://localhost:8081";
/** Client công khai của Hub trong mỗi realm (Authorization Code + PKCE). */
export const HUB_CLIENT_ID = "nexlab-hub";

export interface SeedDept { key: string; name: string; description: string; idpGroup: string }
export interface SeedUser { key: string; email: string; name: string; adminRole: AdminRole; hubRole: HubRole; depts: string[] }

export const NEXLAB_DEPTS: SeedDept[] = [
  { key: "hr", name: "Nhân sự", description: "Hồ sơ nhân viên, chấm công, tuyển dụng", idpGroup: "nhan-su" },
  { key: "acc", name: "Kế toán", description: "Thu chi, công nợ, báo cáo tài chính", idpGroup: "ke-toan" },
  { key: "sales", name: "Kinh doanh", description: "Khách hàng, cơ hội, chăm sóc sau bán", idpGroup: "kinh-doanh" },
  { key: "it", name: "Công nghệ thông tin", description: "Hạ tầng, tài khoản, hỗ trợ nội bộ", idpGroup: "cntt" },
];

export const NEXLAB_USERS: SeedUser[] = [
  { key: "admin", email: "admin@nexlab.tech", name: "Quản trị Nexlab", adminRole: "tenant_admin", hubRole: "admin", depts: ["it"] },
  { key: "m-hr", email: "truongphong.nhansu@nexlab.tech", name: "Lê Thị Hoa (TP Nhân sự)", adminRole: "none", hubRole: "lead", depts: ["hr"] },
  { key: "m-acc", email: "truongphong.ketoan@nexlab.tech", name: "Phạm Văn Đức (TP Kế toán)", adminRole: "none", hubRole: "lead", depts: ["acc"] },
  { key: "m-sales", email: "truongphong.kinhdoanh@nexlab.tech", name: "Trần Minh Quân (TP Kinh doanh)", adminRole: "none", hubRole: "lead", depts: ["sales"] },
  { key: "e-hr", email: "nv.nhansu@nexlab.tech", name: "Nguyễn Thu Hà", adminRole: "none", hubRole: "member", depts: ["hr"] },
  { key: "e-acc", email: "nv.ketoan@nexlab.tech", name: "Võ Thanh Tùng", adminRole: "none", hubRole: "member", depts: ["acc"] },
  { key: "e-sales", email: "nv.kinhdoanh@nexlab.tech", name: "Đặng Khánh Linh", adminRole: "none", hubRole: "member", depts: ["sales"] },
  { key: "e-multi", email: "kiemnhiem@nexlab.tech", name: "Bùi Gia Bảo (Kinh doanh + CNTT)", adminRole: "none", hubRole: "member", depts: ["sales", "it"] },
  { key: "viewer", email: "khach.xem@nexlab.tech", name: "Khách chỉ xem", adminRole: "none", hubRole: "viewer", depts: ["sales"] },
];

/**
 * Người CHỈ có ở Keycloak, chưa có tài khoản ở Control Plane — để thử luồng «nhân viên mới»:
 * đăng nhập SSO lần đầu → Control Plane tự tạo tài khoản (JIT) và xếp vào phòng theo nhóm IdP.
 */
export const NEXLAB_IDP_ONLY_USERS: { email: string; name: string; groups: string[] }[] = [
  { email: "nguoimoi@nexlab.tech", name: "Hoàng Người Mới", groups: ["kinh-doanh"] },
];

export const BV_DEPT = { name: "Khoa Nội", description: "Điều trị nội trú", idpGroup: "khoa-noi" };
export const BV_USERS = [
  { email: "admin@benhvien-b.test", name: "Quản trị BV Demo B", adminRole: "tenant_admin" as AdminRole, hubRole: "admin" as HubRole, inDept: false },
  { email: "bacsi@benhvien-b.test", name: "Bác sĩ Demo", adminRole: "none" as AdminRole, hubRole: "member" as HubRole, inDept: true },
];

export interface SeedRealm {
  realm: string;
  displayName: string;
  /** slug của tenant tương ứng ở Control Plane */
  tenantSlug: string;
  groups: string[];
  users: { email: string; name: string; groups: string[] }[];
}

export const KEYCLOAK_REALMS: SeedRealm[] = [
  {
    realm: "nexlab",
    displayName: "Nexlab",
    tenantSlug: "nexlab",
    groups: NEXLAB_DEPTS.map((d) => d.idpGroup),
    users: [
      ...NEXLAB_USERS.map((u) => ({ email: u.email, name: u.name, groups: u.depts.map((k) => NEXLAB_DEPTS.find((d) => d.key === k)!.idpGroup) })),
      ...NEXLAB_IDP_ONLY_USERS,
    ],
  },
  {
    realm: "benhvien-b",
    displayName: "Bệnh viện Demo B",
    tenantSlug: "benhvien-b",
    groups: [BV_DEPT.idpGroup],
    users: BV_USERS.map((u) => ({ email: u.email, name: u.name, groups: u.inDept ? [BV_DEPT.idpGroup] : [] })),
  },
];

export const issuerOf = (realm: string) => `${KEYCLOAK_URL}/realms/${realm}`;
