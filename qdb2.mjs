import Database from "better-sqlite3";
const db = new Database("./data/lotion.db", { readonly: true });
db.pragma("journal_mode = WAL");
const doc = db.prepare("SELECT id,title,content FROM documents WHERE id=?").get("9dc4528a-c3ae-4cec-91a0-bd976a306ba6");
const blocks = JSON.parse(doc.content);
console.log("title:", doc.title, "| blocks:", blocks.length);
for (const b of blocks) {
  const text = Array.isArray(b.content) ? b.content.map(c=>c.text??c.type).join("") : (typeof b.content==="string"?b.content:JSON.stringify(b.content));
  console.log(`[${b.type}] id=${b.id} content=${JSON.stringify(text)}`);
}
db.close();
