import Database from "better-sqlite3";
const db = new Database("./data/lotion.db", { readonly: true });
db.pragma("journal_mode = WAL");
const docs = db.prepare("SELECT id,title,content FROM documents WHERE content IS NOT NULL AND content LIKE '[%'").all();
let hit = 0;
for (const d of docs) {
  const blocks = JSON.parse(d.content);
  const bad = blocks.filter(b => b.type === "bulletListItem" && Array.isArray(b.content) && /^\[( |x|X|\])\] ?/.test(String(b.content[0]?.text ?? "")));
  if (bad.length) {
    hit++;
    console.log(`\n=== ${d.title} | ${d.id.slice(0,8)} | ${bad.length} 个待转任务项`);
    console.log("  例:", JSON.stringify(bad[0].content?.[0]?.text ?? "").slice(0,60), " id:", bad[0].id);
  }
}
console.log(`\n共 ${docs.length} 篇 JSON 文档，${hit} 篇含旧版坏任务项`);
db.close();
