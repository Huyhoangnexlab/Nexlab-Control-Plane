import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Marked } from "marked";

/**
 * Trang «Hướng dẫn» hiển thị lại CHÍNH các file trong thư mục `docs/` — một nguồn duy nhất, không chép nội dung.
 * Chỉ các file có trong danh sách dưới đây mới đọc được (không nhận đường dẫn từ người dùng → không có path traversal).
 */
export type HelpAudience = "platform" | "tenant_admin" | "manager" | "member";

export interface DocMeta {
  slug: string;
  file: string;
  title: string;
  summary: string;
}

export const DOCS: DocMeta[] = [
  { slug: "01-tong-quan", file: "01-tong-quan.md", title: "Tổng quan & khái niệm", summary: "Tenant, phòng ban, danh mục, mức quyền là gì và liên hệ với nhau thế nào." },
  { slug: "02-vai-tro-va-quyen", file: "02-vai-tro-va-quyen.md", title: "Vai trò & danh mục quyền", summary: "Có bao nhiêu quyền, mỗi quyền gồm gì, vai trò nào được gì." },
  { slug: "03-luat-chong-leo-quyen", file: "03-luat-chong-leo-quyen.md", title: "Luật chống leo quyền", summary: "Hệ thống ngăn lấy bừa / tự nâng quyền bằng cách nào." },
  { slug: "04-huong-dan-van-hanh", file: "04-huong-dan-van-hanh.md", title: "Hướng dẫn vận hành theo vai trò", summary: "Từng bước cho từng vai trò; người mới, chuyển phòng, nghỉ việc." },
  { slug: "05-chinh-sach-them-app-trong-hub", file: "05-chinh-sach-them-app-trong-hub.md", title: "Chính sách thêm app trong Hub", summary: "Vì sao Hub mặc định cấm tự thêm app và cách mở theo quyền." },
  { slug: "06-du-lieu-va-ma-nguon", file: "06-du-lieu-va-ma-nguon.md", title: "Dữ liệu, kiến trúc mã & mở rộng", summary: "Dành cho lập trình viên." },
  { slug: "07-lo-trinh-va-gioi-han", file: "07-lo-trinh-va-gioi-han.md", title: "Lộ trình & giới hạn đã biết", summary: "Cái gì đã làm, chưa làm, rủi ro." },
  { slug: "08-api-cho-hub", file: "08-api-cho-hub.md", title: "API cho Hub & gói quyền ký", summary: "discover, token, entitlements, cách Hub kiểm chữ ký." },
  { slug: "09-dang-nhap-sso-keycloak", file: "09-dang-nhap-sso-keycloak.md", title: "Đăng nhập SSO (OIDC) với Keycloak", summary: "Luồng PKCE, cấu hình IdP, liên kết người dùng, đồng bộ nhóm → phòng ban." },
];

export function findDoc(slug: string): DocMeta | undefined {
  return DOCS.find((d) => d.slug === slug);
}

/** Cùng quy tắc tạo neo với GitHub: chữ thường, bỏ dấu câu (giữ chữ có dấu), khoảng trắng → gạch ngang. */
export function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, "").replace(/\s/g, "-");
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };
const plain = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m] ?? m);

export interface TocItem { id: string; text: string; depth: 2 | 3 }

export interface RenderedDoc { html: string; toc: TocItem[]; title: string }

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function renderMarkdown(md: string): RenderedDoc {
  const toc: TocItem[] = [];
  const used = new Map<string, number>();
  let title = "";
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        const text = plain(inner);
        let id = slugify(text);
        const n = used.get(id) ?? 0;
        used.set(id, n + 1);
        if (n > 0) id = `${id}-${n}`;
        if (depth === 1 && !title) title = text;
        if (depth === 2 || depth === 3) toc.push({ id, text, depth });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      link({ href, title: t, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const doc = /^(?:\.\/)?(\d\d-[a-z0-9-]+)\.md(#.*)?$/.exec(href);
        if (doc) return `<a href="/help/${doc[1]}${doc[2] ?? ""}">${inner}</a>`;
        if (/^(?:\.\/)?README\.md$/.test(href)) return `<a href="/help">${inner}</a>`;
        if (href.startsWith("#")) return `<a href="${escapeHtml(href)}">${inner}</a>`;
        if (/^https?:\/\//.test(href)) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer"${t ? ` title="${escapeHtml(t)}"` : ""}>${inner}</a>`;
        // Đường dẫn tương đối tới file ở repo khác: không bấm được trong ứng dụng → hiện như đoạn mã.
        return `<code class="doc-ref" title="Tài liệu ở repo khác">${inner}</code>`;
      },
    },
  });
  const html = marked.parse(md, { async: false }) as string;
  return { html, toc, title };
}

export async function loadDoc(slug: string): Promise<(DocMeta & RenderedDoc) | null> {
  const meta = findDoc(slug);
  if (!meta) return null;
  const md = await readFile(path.join(process.cwd(), "docs", meta.file), "utf8");
  return { ...meta, ...renderMarkdown(md) };
}

/** Các tài liệu và mục nên đọc trước theo vai trò. Neo tính bằng slugify đúng chuỗi tiêu đề trong file (có test kiểm). */
export const START_HERE: Record<HelpAudience, { slug: string; heading?: string; label: string }[]> = {
  platform: [
    { slug: "04-huong-dan-van-hanh", heading: "4.1 Quản trị nền tảng (Nexlab)", label: "Tạo tổ chức, tạm ngưng, xoá" },
    { slug: "02-vai-tro-va-quyen", heading: "A.3 Tài khoản nền tảng không đọc được gì trong tenant", label: "Giới hạn của quản trị nền tảng" },
    { slug: "09-dang-nhap-sso-keycloak", heading: "9.4 Cấu hình trong Control Plane", label: "Cấu hình SSO cho một tổ chức" },
    { slug: "07-lo-trinh-va-gioi-han", label: "Giới hạn đã biết" },
  ],
  tenant_admin: [
    { slug: "04-huong-dan-van-hanh", heading: "4.2 Quản trị tổ chức (tenant admin)", label: "Thiết lập tổ chức theo đúng thứ tự" },
    { slug: "04-huong-dan-van-hanh", heading: "4.5 Quy trình người mới · chuyển phòng · nghỉ việc (làm tay hôm nay)", label: "Người mới · chuyển phòng · nghỉ việc" },
    { slug: "02-vai-tro-va-quyen", label: "Vai trò & 20 quyền" },
    { slug: "09-dang-nhap-sso-keycloak", heading: "9.6 Đồng bộ nhóm → phòng ban", label: "Nhóm IdP đồng bộ phòng ban thế nào" },
    { slug: "05-chinh-sach-them-app-trong-hub", label: "Vì sao Hub cấm tự thêm app" },
  ],
  manager: [
    { slug: "04-huong-dan-van-hanh", heading: "4.3 Trưởng phòng", label: "Việc của trưởng phòng" },
    { slug: "01-tong-quan", heading: "1.4 Thang mức quyền (áp cho mỗi cặp phòng × app)", label: "Các mức quyền nghĩa là gì" },
    { slug: "03-luat-chong-leo-quyen", label: "Vì sao có những việc bạn không làm được" },
  ],
  member: [
    { slug: "04-huong-dan-van-hanh", heading: "4.4 Nhân viên", label: "Xem app của tôi, thiếu app thì làm gì" },
    { slug: "01-tong-quan", heading: "1.4 Thang mức quyền (áp cho mỗi cặp phòng × app)", label: "Các mức quyền nghĩa là gì" },
  ],
};

export function audienceOf(actor: { adminRole: string; managedDeptIds: string[] }): HelpAudience {
  if (actor.adminRole === "platform_admin") return "platform";
  if (actor.adminRole === "tenant_admin") return "tenant_admin";
  if (actor.managedDeptIds.length > 0) return "manager";
  return "member";
}
