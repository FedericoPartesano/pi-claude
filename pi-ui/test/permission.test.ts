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

test("dangerReason: quoted identifiers with WHERE pass, docker prune -af is caught (review findings)", () => {
	assert.equal(dangerReason(`psql -c 'DELETE FROM "users" WHERE id=1'`), undefined);
	assert.equal(dangerReason(`psql -c 'DELETE FROM "public"."users" WHERE id=1;'`), undefined);
	assert.ok(dangerReason(`psql -c 'DELETE FROM "users";'`));
	assert.ok(dangerReason(`psql -c 'DELETE FROM "public"."users";'`));
	assert.ok(dangerReason("mysql -e \"DELETE FROM shop.orders\""));
	assert.ok(dangerReason("docker system prune -af"));
	assert.ok(dangerReason("docker system prune --all --force"));
});

test("dangerReason on real commands: heredoc bodies written to files are data; env filtered by grep is fine", () => {
	assert.equal(dangerReason("cat >> test/x.test.ts <<'EOF'\nassert.ok(dangerReason(\"DROP TABLE users\"));\ndb.users.deleteMany({})\nEOF\nnode --test"), undefined);
	assert.equal(dangerReason("python3 - <<'EOF'\ns = 'rm -rf /tmp/x'\nEOF"), undefined);
	assert.ok(dangerReason("psql mydb <<'SQL'\nDROP TABLE users;\nSQL"), "a heredoc fed to a database client still counts");
	assert.ok(dangerReason("cat > x <<EOF\nhello\nEOF\nrm -rf build"), "commands after the heredoc still count");
	assert.equal(dangerReason("env | grep -i mongo"), undefined);
	assert.equal(dangerReason("printenv | grep -E 'A|B'"), undefined);
	assert.ok(dangerReason("env"));
	assert.ok(dangerReason("printenv | sort"));
});
