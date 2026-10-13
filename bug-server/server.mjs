import { createApp } from "./app.mjs";
import { mongoStorage } from "./storage.mjs";

const { MONGO_URI = "mongodb://mongo:27017", BUG_TOKEN = "", PORT = "8099", BUG_MAX_MB = "50", BUG_QUOTA_GB = "2", BUG_PER_HOUR = "10" } = process.env;
const storage = await mongoStorage(MONGO_URI);
createApp({ storage, token: BUG_TOKEN, maxBytes: Number(BUG_MAX_MB) * 1024 * 1024, quotaBytes: Number(BUG_QUOTA_GB) * 1024 ** 3, perHour: Number(BUG_PER_HOUR) }).listen(Number(PORT), "0.0.0.0", () => console.log(`bug server in ascolto su :${PORT}`));
