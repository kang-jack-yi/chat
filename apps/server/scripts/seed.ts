import path from "node:path";
import { initializeDatabase } from "../app/lib/database";

async function main() {
  const app: any = {
    baseDir: path.resolve(__dirname, ".."),
    chatDb: null,
  };
  const db = await initializeDatabase(app);
  console.log("演示数据已就绪：13800000001 / 123456");
  await db.sequelize.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
