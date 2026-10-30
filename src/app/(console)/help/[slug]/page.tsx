import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, ListTree } from "lucide-react";
import { requireActor } from "@/server/session";
import { DOCS, loadDoc } from "@/server/docs";
import { cn } from "@/lib/cn";

export default async function HelpDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  await requireActor();
  const doc = await loadDoc(slug);
  if (!doc) notFound();
  const i = DOCS.findIndex((d) => d.slug === slug);
  const prev = i > 0 ? DOCS[i - 1] : null;
  const next = i < DOCS.length - 1 ? DOCS[i + 1] : null;

  return (
    <>
      <Link href="/help" className="mb-4 inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" /> Hướng dẫn</Link>
      <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_240px]">
        <article className="min-w-0 rounded-2xl border border-slate-200/80 bg-white p-7 shadow-card md:p-10">
          {/* Nội dung markdown do chính dự án viết (thư mục docs/, danh sách file cố định) — không phải dữ liệu người dùng. */}
          <div className="doc" dangerouslySetInnerHTML={{ __html: doc.html }} />
          <nav className="mt-10 flex flex-wrap justify-between gap-3 border-t border-slate-100 pt-5 text-sm" aria-label="Trang trước và sau">
            {prev ? <Link href={`/help/${prev.slug}`} className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:text-indigo-500"><ArrowLeft className="size-4" /> {prev.title}</Link> : <span />}
            {next ? <Link href={`/help/${next.slug}`} className="inline-flex items-center gap-1.5 font-medium text-indigo-600 hover:text-indigo-500">{next.title} <ArrowRight className="size-4" /></Link> : <span />}
          </nav>
        </article>

        <aside className="hidden xl:block">
          <div className="sticky top-8">
            <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><ListTree className="size-3.5" /> Trong trang này</p>
            <ul className="max-h-[calc(100vh-8rem)] space-y-0.5 overflow-y-auto border-l border-slate-200 text-[13px] cp-scroll">
              {doc.toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className={cn("block border-l-2 border-transparent py-1 pr-2 leading-snug text-slate-500 hover:border-indigo-400 hover:text-slate-900", t.depth === 3 ? "pl-6" : "pl-3 font-medium text-slate-600")}>{t.text}</a>
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
