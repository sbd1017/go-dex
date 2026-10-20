"""Who may edit. The public pages never need any of this; only /admin and /api/admin do.

DEX_AUTH=site      Behind a reverse proxy that already authenticated the owner (e.g. nginx auth_request) and sets
                   X-Site-User / X-Site-CSRF / X-Site-Expires. Trusted only from a loopback peer (see site_auth.py).
DEX_AUTH=password  A single admin password. Only its scrypt hash is stored (var/admin.json, or the env var
                   DEX_ADMIN_PASSWORD_HASH). Sessions are signed, expiring cookies carrying their own CSRF token.
DEX_AUTH=none      No login at all: anyone can edit. For local development, or a public demo that resets itself.
                   The server refuses to listen on anything but 127.0.0.1 in this mode (put a reverse proxy in front).
"""
import base64
import hashlib
import hmac
import json
import os
import pathlib
import secrets
import time

from . import site_auth

N, R, P = 2 ** 15, 8, 1
COOKIE = "dex_session"
SESSION_SECONDS = 12 * 3600
_MAXMEM = 128 * 1024 * 1024


def hash_password(password: str) -> str:
    if len(password) < 10:
        raise ValueError("Use at least 10 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=N, r=R, p=P, dklen=32, maxmem=_MAXMEM)
    return f"scrypt${N}${R}${P}${base64.b64encode(salt).decode()}${base64.b64encode(digest).decode()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, digest = stored.split("$")
        if scheme != "scrypt":
            return False
        calc = hashlib.scrypt((password or "").encode()[:512], salt=base64.b64decode(salt), n=int(n), r=int(r),
                              p=int(p), dklen=32, maxmem=_MAXMEM)
        return bool(password) and hmac.compare_digest(calc, base64.b64decode(digest))
    except (ValueError, TypeError):
        return False


def _secret(data_dir: pathlib.Path) -> bytes:
    path = data_dir / "secret.key"
    if not path.exists():
        data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as f:
            f.write(secrets.token_bytes(32))
    return path.read_bytes()


class Auth:
    def __init__(self, cfg):
        self.cfg = cfg
        self.mode = cfg.auth
        self._failures: dict[str, list[float]] = {}
        if self.mode == "password":
            self.key = _secret(cfg.data_dir)

    def password_hash(self) -> str:
        if self.cfg.password_hash:
            return self.cfg.password_hash
        try:
            return json.loads((self.cfg.data_dir / "admin.json").read_text())["password_hash"]
        except (OSError, ValueError, KeyError):
            return ""

    # -------------------------------------------------------------- sessions
    def session(self, request) -> dict | None:
        if self.mode == "none":
            return {"u": "owner", "csrf": "dev"}
        if self.mode == "site":
            return site_auth.session_from_proxy(request)
        token = request.cookies.get(COOKIE, "")
        try:
            body, sig = token.rsplit(".", 1)
            if not hmac.compare_digest(sig, self._sign(body)):
                return None
            data = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
            if data["exp"] < time.time():
                return None
            return {"u": "owner", "csrf": data["csrf"], "expires": data["exp"]}
        except (ValueError, KeyError, TypeError):
            return None

    def _sign(self, body: str) -> str:
        return hmac.new(self.key, body.encode(), hashlib.sha256).hexdigest()

    def new_cookie(self) -> str:
        data = {"exp": int(time.time()) + SESSION_SECONDS, "csrf": secrets.token_urlsafe(24)}
        body = base64.urlsafe_b64encode(json.dumps(data).encode()).decode().rstrip("=")
        return f"{body}.{self._sign(body)}"

    # -------------------------------------------------------------- login throttle
    def allowed(self, ip: str) -> bool:
        now = time.time()
        if len(self._failures) > 1000:                # forget old addresses so this never grows without bound
            self._failures = {k: v for k, v in self._failures.items() if v and now - v[-1] < 900}
        recent = [t for t in self._failures.get(ip, []) if now - t < 900]
        self._failures[ip] = recent
        return len(recent) < 5 and sum(len(v) for v in self._failures.values()) < 50

    def failed(self, ip: str) -> None:
        self._failures.setdefault(ip, []).append(time.time())

    def check_password(self, password: str) -> bool:
        stored = self.password_hash()
        return bool(stored) and verify_password(password, stored)
