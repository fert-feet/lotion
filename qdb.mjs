import Database from "better-sqlite3";
const db = new Database("./data/lotion.db", { readonly: true });
db.pragma("journal_mode = WAL");
const cols = db.prepare("PRAGMA table_info(documents)").all().map(c=>c.name);
console.log("cols:", cols.join(","));
const docs = db.prepare("SELECT id, title, updatedAt, substr(content,1,300) AS content FROM documents ORDER BY updatedAt DESC LIMIT 6").all();
for (const d of docs) {
  console.log("\n===== ", d.title, "| id:", d.id, "| updated:", d.updatedAt);
  console.log("content:", JSON.stringify(d.content));
}
db.close();
