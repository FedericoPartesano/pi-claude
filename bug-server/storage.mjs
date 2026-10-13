/** MongoDB storage: each package is a GridFS file ("bugs" bucket) with the form data as metadata. */
import { GridFSBucket, MongoClient, ObjectId } from "mongodb";

export async function mongoStorage(uri, dbName = "pi_bugs") {
	const client = new MongoClient(uri);
	await client.connect();
	const db = client.db(dbName);
	const bucket = new GridFSBucket(db, { bucketName: "bugs" });
	const files = db.collection("bugs.files");
	return {
		async save(stream, meta) {
			const upload = bucket.openUploadStream(meta.name || "bug.tar.gz", { metadata: meta });
			for await (const chunk of stream) if (!upload.write(chunk)) await new Promise((resolve) => upload.once("drain", resolve));
			await new Promise((resolve, reject) => upload.end((error) => (error ? reject(error) : resolve())));
			return upload.id;
		},
		/** Newest first: what the admin sees. */
		async list(limit) {
			const rows = await files.find({}).sort({ uploadDate: -1 }).limit(limit).toArray();
			return rows.map((row) => ({ id: String(row._id), size: row.length, name: row.filename, title: row.metadata?.title, severity: row.metadata?.severity, status: row.metadata?.status ?? "new", receivedAt: row.metadata?.receivedAt ?? row.uploadDate }));
		},
		async open(id) {
			if (!ObjectId.isValid(id)) return undefined;
			const row = await files.findOne({ _id: new ObjectId(id) });
			return row ? { name: String(row.filename).replace(/[^\w.-]/g, "_"), stream: bucket.openDownloadStream(row._id) } : undefined;
		},
		async removeById(id) {
			if (!ObjectId.isValid(id) || !(await files.findOne({ _id: new ObjectId(id) }))) return false;
			await bucket.delete(new ObjectId(id));
			return true;
		},
		async setStatus(id, status) {
			if (!ObjectId.isValid(id)) return false;
			return (await files.updateOne({ _id: new ObjectId(id) }, { $set: { "metadata.status": status } })).matchedCount > 0;
		},
		remove: (id) => bucket.delete(id),
		async usage() {
			const [row] = await files.aggregate([{ $group: { _id: null, total: { $sum: "$length" } } }]).toArray();
			return row?.total ?? 0;
		},
		async removeOldest(keepId) {
			const [oldest] = await files.find({ _id: { $ne: keepId } }).sort({ uploadDate: 1 }).limit(1).toArray();
			if (!oldest) return false;
			await bucket.delete(oldest._id);
			return true;
		},
		close: () => client.close(),
	};
}
