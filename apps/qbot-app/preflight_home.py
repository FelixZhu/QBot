#!/usr/bin/env python3
"""Stop an APK build while the shell URL is not actually serving a page.

Reads HOME_URL from App.tsx. Exits 0 only when that URL's version.json
returns HTTP 200 and a version field. Does not print credentials.
"""
import json, re, sys, urllib.request
from pathlib import Path

src = Path(__file__).with_name("App.tsx").read_text(encoding="utf-8")
match = re.search(r"const HOME_URL = '([^']+)';", src)
if not match:
    sys.exit("HOME_URL missing from App.tsx")
home = match.group(1)
url = home.rstrip("/") + "/version.json"
try:
    with urllib.request.urlopen(url, timeout=20) as response:
        status = response.status
        body = response.read()
except Exception as exc:
    print("home not live: %s %s" % (url, type(exc).__name__))
    sys.exit(2)
try:
    version = json.loads(body.decode("utf-8")).get("version")
except ValueError:
    version = None
if status != 200 or not version:
    print("home not live: %s status %s" % (url, status))
    sys.exit(2)
print("home live: %s version %s" % (url, version))
