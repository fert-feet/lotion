import Database from "better-sqlite3";
const db = new Database("./data/lotion.db", { readonly: true });
db.pragma("journal_mode = WAL");
const chats = db.prepare("SELECT id, userId, title, createdAt FROM chat_sessions ORDER BY createdAt DESC LIMIT 3").all();
for (const c of chats) {
  console.log("\n=== session", c.title, c.id.slice(0,8), c.createdAt);
  const msgs = db.prepare("SELECT role, substr(content,1,1200) AS content FROM chat_messages WHERE sessionId=? ORDER BY createdAt LIMIT 6").all(c.id);
  for (const m of msgs) {
    console.log(`  [${m.role}]`, JSON.stringify(m.content).slice(0, 700));
  }
}
db.close();
