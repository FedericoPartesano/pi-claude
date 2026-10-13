# bug-server

Receives the packages that `/bugreport` sends and keeps them in its own MongoDB (GridFS, database `pi_bugs`, bucket `bugs`).

- `POST /` with the `.tar.gz` as body and `Authorization: Bearer <BUG_TOKEN>`; `GET /health`.
- Limits: `BUG_MAX_MB` (50) per package, `BUG_PER_HOUR` (10) per IP, `BUG_QUOTA_GB` (2) in total: past the quota the oldest packages are deleted.
- The token only keeps casual spam out: this repo is public, so it is not a secret once it is in the client.

## Run

    echo "BUG_TOKEN=$(openssl rand -hex 24)" > server.env && chmod 600 server.env
    docker compose --env-file server.env up -d --build

The server listens on `127.0.0.1:8099` only. Put a proxy or `tailscale funnel` in front to open it.
The environment file stays out of git (see `.gitignore`).

## Read the packages (admin only)

Only the admin reads. Set `BUG_ADMIN_PASSWORD` in `server.env` (without it there is no way to read over HTTP). From Pi:
`/bugs` logs in (the password is asked once, or read from `~/.pi/agent/bug-admin-password`, mode 600), lists the newest 50
and downloads the chosen package into `~/.pi/bugs/received/`. The login token lasts 12 h and lives in server memory;
5 wrong passwords per IP lock logins for 15 min. The public upload token never opens the reading routes.

Straight from the database:

    docker compose exec bug-mongo mongosh --eval 'db.getSiblingDB("pi_bugs").bugs.files.find({}, {filename:1,length:1,metadata:1})'

To download one: `mongofiles` or any GridFS client against the `bug-mongo` container.

## Tests

    npm install && npm test
