import { test } from "node:test";
import assert from "node:assert/strict";
import { dangerReason } from "../src/permission.ts";

test("dangerReason: databases, more git, containers, processes and printing secrets (from claude-mods' list)", () => {
	const flagged = [
		'psql -c "DROP TABLE ordini"',
		"sqlcmd -Q 'DROP DATABASE prod'",
		'mysql -e "TRUNCATE TABLE clienti"',
		'psql -c "DELETE FROM ordini;"',
		"psql -c \"UPDATE ordini SET stato='x'\"",
		"mongosh --eval 'db.dropDatabase()'",
		"mongosh --eval 'db.ordini.drop()'",
		"mongosh --eval 'db.ordini.deleteMany({})'",
		"git checkout -- .",
		"git branch -D feature/x",
		"git stash drop",
		"docker system prune -a",
		"docker volume prune -f",
		"kubectl delete namespace prod",
		"kubectl delete pods --all",
		"kill -9 1",
		"killall -9 node",
		"printenv",
		"env | sort",
		"cat .env",
		"cat config/.env.production",
	];
	for (const command of flagged) assert.ok(dangerReason(command), command);
	const safe = [
		'psql -c "DELETE FROM ordini WHERE id = 3;"',
		"psql -c \"UPDATE ordini SET stato='x' WHERE id = 3\"",
		"mongosh --eval 'db.ordini.deleteMany({ stato: \"bozza\" })'",
		"git checkout -- src/app.ts",
		"git branch -d merged-branch",
		"env NODE_ENV=test node app.js",
		"cat .env.example",
		"echo DROP is a word",
	];
	for (const command of safe) assert.equal(dangerReason(command), undefined, command);
});
