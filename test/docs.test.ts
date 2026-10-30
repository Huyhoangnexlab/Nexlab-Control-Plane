/**
 * Kiểm tài liệu: mọi liên kết nội bộ và mọi «Dành cho bạn» phải trỏ tới tiêu đề có thật — tránh link chết khi sửa docs.
 * Không cần Postgres.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DOCS, renderMarkdown, slugify, START_HERE } from "@/server/docs";
import { PERMS, PERM_INFO, ROLE_PERMS } from "@/lib/hub-permissions";

const DOCS_DIR = path.join(process.cwd(), "docs");
const read = (file: string) => readFileSync(path.join(DOCS_DIR, file), "utf8");
const rendered = new Map(DOCS.map((d) => [d.slug, renderMarkdown(read(d.file))]));

describe("tài liệu", () => {
  it("mọi file NN-*.md trong docs/ đều có trong danh sách của trang Hướng dẫn", () => {
    const files = readdirSync(DOCS_DIR).filter((f) => /^\d\d-.*\.md$/.test(f)).sort();
    expect(DOCS.map((d) => d.file).sort()).toEqual(files);
  });

  it("slugify khớp quy tắc neo của GitHub với tiêu đề tiếng Việt", () => {
    expect(slugify("1.6 Hai tầng quyền — đừng nhầm")).toBe("16-hai-tầng-quyền--đừng-nhầm");
    expect(slugify("4.2 Quản trị tổ chức (tenant admin)")).toBe("42-quản-trị-tổ-chức-tenant-admin");
  });

  it("mọi liên kết giữa các tài liệu (NN-*.md#neo) đều tới đúng tiêu đề", () => {
    const bad: string[] = [];
    for (const d of DOCS) {
      const md = read(d.file);
      for (const m of md.matchAll(/\]\(((?:\d\d-[a-z0-9-]+\.md)|README\.md)?(#[^)]*)?\)/g)) {
        const [, file, hash] = m;
        if (file === "README.md" || (!file && !hash)) continue;
        const target = file ? file.replace(/\.md$/, "") : d.slug;
        const doc = rendered.get(target);
        if (!doc) {
          bad.push(`${d.file}: không có tài liệu ${file}`);
          continue;
        }
        if (hash && !doc.toc.some((t) => `#${t.id}` === hash)) bad.push(`${d.file} → ${file ?? ""}${hash}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("mọi mục «Dành cho bạn» trỏ tới tiêu đề có thật", () => {
    const bad: string[] = [];
    for (const [aud, items] of Object.entries(START_HERE))
      for (const it of items) {
        const r = rendered.get(it.slug);
        if (!r) bad.push(`${aud}: thiếu tài liệu ${it.slug}`);
        else if (it.heading && !r.toc.some((t) => t.id === slugify(it.heading!))) bad.push(`${aud}: ${it.slug} thiếu tiêu đề «${it.heading}»`);
      }
    expect(bad).toEqual([]);
  });

  it("bảng 20 quyền trong docs/02 khớp danh mục quyền trong mã", () => {
    const doc02 = read("02-vai-tro-va-quyen.md");
    for (const p of PERMS) expect(doc02, `thiếu quyền ${p} trong docs/02`).toContain(`\`${p}\``);
    // chế độ 1: không vai nào có app.add / app.remove, và docs ghi đúng điều đó
    for (const role of Object.keys(ROLE_PERMS) as (keyof typeof ROLE_PERMS)[]) {
      expect(ROLE_PERMS[role]).not.toContain("app.add");
      expect(ROLE_PERMS[role]).not.toContain("app.remove");
    }
    expect(PERMS).toHaveLength(15);
    expect(Object.keys(PERM_INFO)).toHaveLength(15);
  });

  it("không có markdown nào còn liên kết tương đối tới nơi không hiển thị được ngoài các tài liệu repo Hub", () => {
    const refs = [...rendered.values()].flatMap((r) => r.html.match(/class="doc-ref"/g) ?? []);
    // doc-ref chỉ dành cho đường dẫn sang repo khác (docs/README liệt kê); không được tràn lan
    expect(refs.length).toBeLessThan(10);
  });
});
