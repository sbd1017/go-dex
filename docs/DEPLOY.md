# Deploying

godex is one small Python process (FastAPI + SQLite) behind a reverse proxy. It needs no outbound network
access at all once the catalog and images are in place.

## With an existing site login (DEX_AUTH=site)

For a site where the reverse proxy already authenticates you (for example nginx `auth_request` against your own
login service), godex trusts three headers from a loopback peer only: `X-Site-User: owner`, `X-Site-CSRF`
(32+ url-safe characters, used as the CSRF token) and `X-Site-Expires` (unix time). The proxy must overwrite
them after authenticating, and must clear them on public paths. See `godex/site_auth.py`.

1. `cp deploy.env.example deploy.env` and fill it in.
2. `scripts/deploy.sh --install --sprites` creates the system user, the private `var/` directory, the venv, the
   systemd units (service + daily backup timer, keeps 30), and installs the nginx snippets.
3. In your nginx site, once:
   * `include` the rendered locations snippet inside the `server {}` block;
   * allow POST to `<base>/api/admin/` if you restrict methods globally.
4. Later deploys: `scripts/deploy.sh` (add `--sprites` when images change).

The rendered nginx snippet makes everything under the base path public for GET/HEAD and strips identity
headers there, while `<base>/admin` and `<base>/api/admin/` keep the server's login.

## On its own (DEX_AUTH=password)

```bash
python -m godex.cli init
python -m godex.cli set-password
DEX_AUTH=password python -m godex.serve
```

Serve it over HTTPS (cookies are `Secure` unless `DEX_SECURE_COOKIES=0`). Remove the `Cookie ""` line from
`deploy/nginx/godex-proxy.conf` in this mode, because the admin session is a cookie.

## Backups and restore

* `python -m godex.cli backup` writes an integrity-checked copy to `var/backups/` (the timer runs it daily).
* Imports take a backup first (`var/backups/before-import-*.sqlite3`).
* `Data -> Export` gives a JSON file of the whole collection that `Data -> Import` (or `godex.cli import`) reads back.
* To restore a database backup: stop the service, copy the backup over `var/dex.sqlite3`, start it.

## Keeping the Pokédex up to date

New Pokémon, forms, costumes, shinies and backgrounds reach the catalog in two ways:

* **Automatically, every week** (with `--install`): `<service>-catalog.timer` runs `python -m godex.cli catalog-update`
  on Monday mornings. It downloads the sources, rebuilds the catalog, and only if it passes the checks (no species
  lost, no big drop in forms, shinies or backgrounds) saves it as `var/catalog.json` and loads it. If a source is
  down or changed shape, nothing changes and the run is marked failed (`journalctl -u <service>-catalog`). What an
  update added is listed on the admin Data page. This is the only godex process with internet access.
* **With the code**: `data/catalog.json` in the repository is rebuilt with `python tools/build_catalog.py --refresh`
  and shipped by a deploy. Whichever catalog was built most recently is the one used.

Your collection is never touched by an update, and the "Counts" switch on any variant always beats the catalog.
New costumes may need icons: `python tools/fetch_sprites.py` (only downloads what is missing), then deploy with
`--sprites`.
