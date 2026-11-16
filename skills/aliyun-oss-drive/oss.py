#!/usr/bin/env python3
"""oss.py - Dropbox-style command line drive for an Aliyun OSS bucket.

Credentials come from OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET and are never
printed or logged. Endpoint/bucket default to the values below and can be
overridden with OSS_ENDPOINT / OSS_BUCKET.

Run `oss.py -h` or `oss.py <command> -h` for usage.

Exit codes:
  0 ok | 1 error | 2 usage | 3 not found | 4 already exists (needs --overwrite)
  5 needs confirmation (--yes) | 6 versioning off | 7 network failure after retries
"""
import argparse, contextlib, datetime as dt, fcntl, json, os, re, sys, time
import oss2

ENDPOINT = os.environ.get("OSS_ENDPOINT", "https://oss-cn-beijing.aliyuncs.com")
BUCKET = os.environ.get("OSS_BUCKET", "qian-grokbot")
HOME = os.path.expanduser("~")
RESUME_DIR = os.path.join(HOME, ".oss_resume")
INDEX_FILE = os.path.join(HOME, ".oss_index.json")
SHARES_FILE = os.path.join(HOME, ".oss_shares.json")
OPS_LOG = os.path.join(HOME, ".oss_ops.log")
PART = 4 * 1024 * 1024
THREADS = 3
COPY_LIMIT = 1024 ** 3          # copy_object max; larger objects use multipart copy
COPY_PART = 100 * 1024 * 1024
BATCH_LIMIT = 20
MAX_SHARE_DAYS = 7
TRASH = "trash/"
TRASH_SEG = re.compile(r"^(\d{4}-\d{2}-\d{2})(_\d{6})?$")


class Fail(Exception):
    def __init__(self, msg, code=1):
        super().__init__(msg)
        self.code = code


# ---------------------------------------------------------------- helpers
def bucket():
    kid, sec = os.environ.get("OSS_ACCESS_KEY_ID"), os.environ.get("OSS_ACCESS_KEY_SECRET")
    if not kid or not sec:
        raise Fail("OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET not set in the environment")
    return oss2.Bucket(oss2.Auth(kid, sec), ENDPOINT, BUCKET, connect_timeout=600)


def norm(key):
    """Accept 'oss://bucket/key', '/key' or 'key'."""
    key = key or ""
    if key.startswith("oss://"):
        key = key[6:].split("/", 1)[1] if "/" in key[6:] else ""
    return key.lstrip("/")


def human(n):
    n = float(n)
    for u in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or u == "TB":
            return f"{n:.0f} {u}" if u == "B" else f"{n:.1f} {u}"
        n /= 1024


def parse_size(s):
    m = re.fullmatch(r"\s*([\d.]+)\s*([kmgt]?)b?\s*", s.lower())
    if not m:
        raise Fail(f"bad size: {s} (use e.g. 500K, 10M, 2G)", 2)
    return int(float(m.group(1)) * 1024 ** "_kmgt".index(m.group(2) or "_"))


def parse_date(s, end=False):
    try:
        d = dt.datetime.strptime(s, "%Y-%m-%d")
    except ValueError:
        raise Fail(f"bad date: {s} (use YYYY-MM-DD)", 2)
    if end:
        d += dt.timedelta(days=1)
    return d.timestamp()


def ts(t):
    return time.strftime("%Y-%m-%d %H:%M:%S %Z", time.localtime(t))


def retry(fn, tries=4, what="request"):
    for i in range(tries):
        try:
            return fn()
        except oss2.exceptions.RequestError as e:          # network level
            err = e
        except oss2.exceptions.ServerError as e:
            if e.status < 500 and e.status not in (408, 429):
                raise
            err = e
        if i < tries - 1:
            wait = min(5 * (i + 1), 30)
            print(f"retry {i + 1}/{tries - 1} for {what} in {wait}s: {type(err).__name__}", file=sys.stderr, flush=True)
            time.sleep(wait)
    raise Fail(f"{what} failed after {tries} attempts: {type(err).__name__}", 7)


@contextlib.contextmanager
def locked_json(path, default):
    """Read-modify-write a JSON state file under an exclusive lock."""
    with open(path + ".lock", "a") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            with open(path) as f:
                data = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            data = default
        yield data
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)


def read_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def log_op(op, keys=(), **extra):
    keys = list(keys)
    rec = {"time": dt.datetime.now().astimezone().isoformat(timespec="seconds"),
           "op": op, "bucket": BUCKET, "count": len(keys), "keys": keys[:50]}
    rec.update(extra)
    with open(OPS_LOG, "a") as f:
        f.write(json.dumps(rec, ensure_ascii=False) + "\n")


def index_update(set_=None, delete=(), move=None):
    """Keep the local index in step with writes. set_: {key: (size, mtime)}."""
    with locked_json(INDEX_FILE, {}) as data:
        idx = data.setdefault(BUCKET, {"updated": None, "objects": {}})["objects"]
        for old, new in (move or {}).items():
            meta = {k: v for k, v in idx.pop(old, {}).items() if k in ("tags", "summary")}
            idx[new] = {**idx.get(new, {}), **meta}
        for k in delete:
            idx.pop(k, None)
        for k, (size, mtime) in (set_ or {}).items():
            idx.setdefault(k, {}).update(size=size, mtime=mtime)


def listing(b, prefix, recursive=True):
    """Yield SimplifiedObjectInfo; directories are entries with is_prefix()."""
    it = oss2.ObjectIterator(b, prefix=prefix, delimiter="" if recursive else "/", max_keys=1000)
    return retry(lambda: list(it), what=f"list {prefix or '/'}")


def exists(b, key):
    return retry(lambda: b.object_exists(key), what=f"exists {key}")


def resolve(b, key):
    """Return (is_prefix, base_prefix, [objects]) for a key or a prefix."""
    key = norm(key)
    if not key:
        raise Fail("refusing to operate on the whole bucket; give a key or prefix", 2)
    if not key.endswith("/") and exists(b, key):
        h = retry(lambda: b.head_object(key), what=f"head {key}")
        return False, key, [oss2.models.SimplifiedObjectInfo(key, h.last_modified, h.etag, None, h.content_length, None)]
    base = key if key.endswith("/") else key + "/"
    objs = [o for o in listing(b, base) if not o.is_prefix()]
    if not objs:
        raise Fail(f"not found: oss://{BUCKET}/{key}", 3)
    return True, base, objs


def need_yes(n, a, what):
    if n > BATCH_LIMIT and not getattr(a, "yes", False):
        raise Fail(f"{what} affects {n} objects (> {BATCH_LIMIT}); re-run with --yes after confirming", 5)


def emit(a, data, text):
    if getattr(a, "json", False):
        print(json.dumps(data, ensure_ascii=False, indent=1))
    else:
        for line in text:
            print(line)


def obj_dict(o):
    return {"key": o.key, "size": o.size, "mtime": o.last_modified, "mtime_local": ts(o.last_modified), "etag": o.etag}


def remote_mtime(b, key, fallback):
    h = retry(lambda: b.head_object(key), what=f"head {key}")
    m = h.headers.get("x-oss-meta-mtime")
    return float(m) if m else fallback


# ---------------------------------------------------------------- core transfers
def upload_file(b, path, key):
    st = os.stat(path)
    store = oss2.ResumableStore(root=RESUME_DIR)
    headers = {"x-oss-meta-mtime": str(int(st.st_mtime))}
    retry(lambda: oss2.resumable_upload(b, key, path, store=store, headers=headers,
                                        multipart_threshold=PART, part_size=PART, num_threads=THREADS),
          tries=8, what=f"upload {key}")
    return st.st_size, int(st.st_mtime)


def download_file(b, key, path, mtime=None):
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    store = oss2.ResumableDownloadStore(root=RESUME_DIR)
    retry(lambda: oss2.resumable_download(b, key, path, store=store, multiget_threshold=PART,
                                          part_size=PART, num_threads=THREADS),
          tries=8, what=f"download {key}")
    if mtime:
        os.utime(path, (mtime, mtime))


def copy_object(b, src, dst, size, etag):
    if size <= COPY_LIMIT:
        retry(lambda: b.copy_object(BUCKET, src, dst), what=f"copy {src}")
    else:
        h = b.head_object(src)
        hdr = {k: v for k, v in h.headers.items() if k.lower().startswith("x-oss-meta-") or k.lower() == "content-type"}
        uid = retry(lambda: b.init_multipart_upload(dst, headers=hdr), what="init copy").upload_id
        parts, n, start = [], 1, 0
        while start < size:
            end = min(start + COPY_PART, size) - 1
            r = retry(lambda: b.upload_part_copy(BUCKET, src, (start, end), dst, uid, n), what=f"copy part {n}")
            parts.append(oss2.models.PartInfo(n, r.etag))
            start, n = end + 1, n + 1
        retry(lambda: b.complete_multipart_upload(dst, uid, parts), what="complete copy")
    h = retry(lambda: b.head_object(dst), what=f"verify {dst}")
    if h.content_length != size or (size <= COPY_LIMIT and etag and h.etag != etag):
        raise Fail(f"copy verification failed for {src} -> {dst}; source kept")


def plan_copy(b, src, dst):
    is_pfx, base, objs = resolve(b, src)
    dst = norm(dst)
    if is_pfx:
        dbase = dst.rstrip("/") + "/" if dst else ""
        pairs = [(o, dbase + o.key[len(base):]) for o in objs]
    else:
        pairs = [(objs[0], dst + os.path.basename(base) if (dst.endswith("/") or not dst) else dst)]
    for o, d in pairs:
        if o.key == d:
            raise Fail(f"source and destination are the same: {d}", 2)
    return pairs


def check_overwrite(b, keys, a):
    if getattr(a, "overwrite", False):
        return
    clash = [k for k in keys if exists(b, k)]
    if clash:
        raise Fail("destination exists (use --overwrite after confirming): " + ", ".join(clash[:10])
                   + (f" ... (+{len(clash) - 10})" if len(clash) > 10 else ""), 4)


def transfer(b, pairs, delete_src):
    done = {}
    for o, d in pairs:
        copy_object(b, o.key, d, o.size, o.etag)
        if delete_src:
            retry(lambda: b.delete_object(o.key), what=f"delete {o.key}")
        done[o.key] = d
    return done


def purge(b, keys):
    keys = list(keys)
    for i in range(0, len(keys), 1000):
        chunk = keys[i:i + 1000]
        retry(lambda: b.batch_delete_objects(chunk), what="batch delete")


def trash_dest(b, keys):
    seg = dt.date.today().isoformat()
    if any(exists(b, TRASH + seg + "/" + k) for k in keys):
        seg += time.strftime("_%H%M%S")
    return TRASH + seg + "/"


def parse_trash_key(k):
    """trash/<date>[_HHMMSS]/<orig> -> (date_seg, orig)"""
    parts = k[len(TRASH):].split("/", 1)
    if len(parts) == 2 and TRASH_SEG.match(parts[0]):
        return parts[0], parts[1]
    return None, None


# ---------------------------------------------------------------- commands
def cmd_ls(b, a):
    prefix = norm(a.prefix)
    if prefix and not prefix.endswith("/") and not exists(b, prefix):
        prefix += "/"
    objs = listing(b, prefix, a.recursive)
    dirs = [o.key for o in objs if o.is_prefix() or (o.key.endswith("/") and o.key != prefix)]
    files = [o for o in objs if not o.is_prefix() and not o.key.endswith("/")]
    if a.sort == "size":
        files.sort(key=lambda o: o.size, reverse=True)
    elif a.sort == "time":
        files.sort(key=lambda o: o.last_modified, reverse=True)
    lines = [f"{'DIR':>10}  {'':19}  {d}" for d in dirs]
    lines += [f"{human(o.size):>10}  {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(o.last_modified))}  {o.key}" for o in files]
    lines.append(f"-- {len(dirs)} dirs, {len(files)} files, {human(sum(o.size for o in files))}  (times {time.strftime('%Z')})")
    emit(a, {"prefix": prefix, "dirs": dirs, "files": [obj_dict(o) for o in files]}, lines)


def cmd_stat(b, a):
    key = norm(a.key)
    try:
        h = retry(lambda: b.head_object(key), what=f"head {key}")
    except oss2.exceptions.NotFound:
        raise Fail(f"not found: oss://{BUCKET}/{key}", 3)
    hd = h.headers
    d = {"key": key, "url": f"oss://{BUCKET}/{key}", "size": h.content_length, "size_h": human(h.content_length),
         "content_type": h.content_type, "mtime": h.last_modified, "mtime_local": ts(h.last_modified),
         "etag": h.etag, "storage_class": hd.get("x-oss-storage-class"), "version_id": hd.get("x-oss-version-id"),
         "meta": {k[11:]: v for k, v in hd.items() if k.lower().startswith("x-oss-meta-")}}
    ent = read_json(INDEX_FILE, {}).get(BUCKET, {}).get("objects", {}).get(key, {})
    d["tags"], d["summary"] = ent.get("tags"), ent.get("summary")
    emit(a, d, [f"{k}: {v}" for k, v in d.items() if v not in (None, {}, [])])


def cmd_du(b, a):
    prefix = norm(a.prefix)
    if prefix and not prefix.endswith("/"):
        prefix += "/"
    groups, total, n = {}, 0, 0
    for o in listing(b, prefix):
        rest = o.key[len(prefix):]
        g = rest.split("/", 1)[0] + "/" if "/" in rest else "(files)"
        c = groups.setdefault(g, [0, 0])
        c[0] += 1; c[1] += o.size
        total += o.size; n += 1
    lines = [f"{human(s):>10}  {c:>6} obj  {prefix}{g if g != '(files)' else ''}{'' if g != '(files)' else '(files at this level)'}"
             for g, (c, s) in sorted(groups.items(), key=lambda x: -x[1][1])]
    lines.append(f"{human(total):>10}  {n:>6} obj  TOTAL oss://{BUCKET}/{prefix}")
    emit(a, {"prefix": prefix, "objects": n, "bytes": total,
             "groups": {g: {"objects": c, "bytes": s} for g, (c, s) in groups.items()}}, lines)


def cmd_put(b, a):
    src, dst = a.local, norm(a.key)
    if os.path.isdir(src):
        base = dst.rstrip("/") + "/" if dst else ""
        pairs = []
        for root, _, files in os.walk(src):
            for f in sorted(files):
                p = os.path.join(root, f)
                pairs.append((p, base + os.path.relpath(p, src).replace(os.sep, "/")))
    elif os.path.isfile(src):
        pairs = [(src, dst + os.path.basename(src) if (not dst or dst.endswith("/")) else dst)]
    else:
        raise Fail(f"local path not found: {src}", 3)
    if not pairs:
        raise Fail(f"nothing to upload in {src}", 2)
    check_overwrite(b, [k for _, k in pairs], a)
    done = {}
    for p, k in pairs:
        done[k] = upload_file(b, p, k)
        print(f"uploaded  {human(done[k][0]):>10}  oss://{BUCKET}/{k}", flush=True)
    index_update(set_=done)
    log_op("put", done.keys(), overwrite=a.overwrite)
    print(f"-- {len(done)} file(s), {human(sum(s for s, _ in done.values()))}")


def cmd_get(b, a):
    is_pfx, base, objs = resolve(b, a.key)
    if is_pfx:
        pairs = [(o, os.path.join(a.local, *o.key[len(base):].split("/"))) for o in objs if not o.key.endswith("/")]
    else:
        dest = os.path.join(a.local, os.path.basename(base)) if (os.path.isdir(a.local) or a.local.endswith("/")) else a.local
        pairs = [(objs[0], dest)]
    if not a.overwrite:
        clash = [p for _, p in pairs if os.path.exists(p)]
        if clash:
            raise Fail("local file exists (use --overwrite): " + ", ".join(clash[:10]), 4)
    for o, p in pairs:
        download_file(b, o.key, p, remote_mtime(b, o.key, o.last_modified))
        print(f"downloaded  {human(o.size):>10}  {p}", flush=True)
    print(f"-- {len(pairs)} file(s), {human(sum(o.size for o, _ in pairs))}")


def _cp_mv(b, a, delete_src):
    pairs = plan_copy(b, a.src, a.dst)
    if delete_src:
        need_yes(len(pairs), a, "mv")
    check_overwrite(b, [d for _, d in pairs], a)
    done = transfer(b, pairs, delete_src)
    if delete_src:
        index_update(move=done)
    sizes = {d: (o.size, int(time.time())) for o, d in pairs}
    index_update(set_=sizes)
    log_op("mv" if delete_src else "cp", done.keys(), dest=list(done.values())[:50], overwrite=a.overwrite)
    for s, d in done.items():
        print(f"{'moved' if delete_src else 'copied'}  {s}  ->  {d}")
    print(f"-- {len(done)} object(s)")


def cmd_cp(b, a): _cp_mv(b, a, False)
def cmd_mv(b, a): _cp_mv(b, a, True)


def cmd_mkdir(b, a):
    key = norm(a.prefix).rstrip("/") + "/"
    if key == "/":
        raise Fail("give a directory name", 2)
    if exists(b, key):
        print(f"exists: oss://{BUCKET}/{key}")
        return
    retry(lambda: b.put_object(key, b""), what=f"mkdir {key}")
    log_op("mkdir", [key])
    print(f"created: oss://{BUCKET}/{key}")


def cmd_rm(b, a):
    is_pfx, base, objs = resolve(b, a.key)
    keys = [o.key for o in objs]
    need_yes(len(keys), a, "rm")
    if a.purge:
        purge(b, keys)
        index_update(delete=keys)
        log_op("purge", keys)
        print(f"permanently deleted {len(keys)} object(s) under oss://{BUCKET}/{base}")
        return
    if any(k.startswith(TRASH) for k in keys):
        raise Fail("target is already in trash/; use `trash empty` or `rm --purge`", 2)
    tdir = trash_dest(b, keys)
    done = transfer(b, [(o, tdir + o.key) for o in objs], True)
    index_update(delete=keys)
    log_op("trash", keys, trash=tdir)
    print(f"moved {len(done)} object(s) to oss://{BUCKET}/{tdir}  (restore: oss.py trash restore <key>)")


def trash_entries(b):
    out = []
    for o in listing(b, TRASH):
        seg, orig = parse_trash_key(o.key)
        if orig is not None:
            out.append((seg, orig, o))
    return out


def cmd_trash(b, a):
    ents = trash_entries(b)
    if getattr(a, "prefix", None):
        ents = [e for e in ents if e[1].startswith(norm(a.prefix))]
    if a.tcmd == "ls":
        ents.sort(key=lambda e: (e[0], e[1]), reverse=True)
        emit(a, [{"deleted": s, "key": k, "trash_key": o.key, "size": o.size} for s, k, o in ents],
             [f"{s:<17}  {human(o.size):>10}  {k}" for s, k, o in ents]
             + [f"-- {len(ents)} object(s) in trash, {human(sum(o.size for *_, o in ents))}"])
    elif a.tcmd == "restore":
        want = norm(a.key)
        if want.startswith(TRASH):                        # exact trash key or trash prefix
            sel = [e for e in ents if e[2].key == want or e[2].key.startswith(want.rstrip("/") + "/")]
        else:
            sel = [e for e in ents if e[1] == want or (want.endswith("/") and e[1].startswith(want))
                   or e[1].startswith(want + "/")]
            if a.date:
                sel = [e for e in sel if e[0].startswith(a.date)]
        if not sel:
            raise Fail(f"not in trash: {want}", 3)
        latest = {}
        for s, k, o in sel:                                # newest deletion wins per key
            if k not in latest or s > latest[k][0]:
                latest[k] = (s, o)
        pairs = [(o, k) for k, (s, o) in latest.items()]
        need_yes(len(pairs), a, "trash restore")
        check_overwrite(b, [k for _, k in pairs], a)
        done = transfer(b, pairs, True)
        index_update(set_={k: (o.size, o.last_modified) for o, k in pairs})
        log_op("restore", done.values(), source=list(done.keys())[:50])
        for s, d in done.items():
            print(f"restored  {d}  (from {s})")
    elif a.tcmd == "empty":
        today = dt.date.today()
        sel = [o.key for s, k, o in ents
               if (today - dt.date.fromisoformat(s[:10])).days >= a.older_than]
        if not sel:
            print(f"nothing in trash older than {a.older_than} days")
            return
        need_yes(len(sel), a, "trash empty")
        purge(b, sel)
        log_op("trash-empty", sel, older_than=a.older_than)
        print(f"permanently deleted {len(sel)} trashed object(s) older than {a.older_than} days")


def cmd_find(b, a):
    prefix = norm(a.prefix)
    use_index = a.index or a.tag or a.text
    if use_index:
        idx = read_json(INDEX_FILE, {}).get(BUCKET)
        if not idx:
            raise Fail("local index is empty; run `oss.py index rebuild` first", 3)
        rows = [{"key": k, "size": v.get("size", 0), "mtime": v.get("mtime", 0),
                 "tags": v.get("tags", []), "summary": v.get("summary", "")}
                for k, v in idx["objects"].items() if k.startswith(prefix)]
    else:
        rows = [{"key": o.key, "size": o.size, "mtime": o.last_modified} for o in listing(b, prefix)]
    exts = {"." + e.lower().lstrip(".") for e in a.ext.split(",")} if a.ext else None
    lo = parse_date(a.since) if a.since else None
    hi = parse_date(a.until, end=True) if a.until else None
    mn = parse_size(a.min) if a.min else None
    mx = parse_size(a.max) if a.max else None
    want_tags = {t.lower() for t in (a.tag or [])}
    res = []
    for r in rows:
        k = r["key"]
        if k.endswith("/"):
            continue
        if k.startswith(TRASH) and not (a.include_trash or prefix.startswith(TRASH)):
            continue
        if a.keyword and a.keyword.lower() not in k.lower():
            continue
        if exts and os.path.splitext(k)[1].lower() not in exts:
            continue
        if (lo and r["mtime"] < lo) or (hi and r["mtime"] >= hi):
            continue
        if (mn is not None and r["size"] < mn) or (mx is not None and r["size"] > mx):
            continue
        if want_tags and not want_tags <= {t.lower() for t in r.get("tags", [])}:
            continue
        if a.text:
            hay = " ".join([k, r.get("summary", ""), " ".join(r.get("tags", []))]).lower()
            if not all(w in hay for w in a.text.lower().split()):
                continue
        r["mtime_local"] = ts(r["mtime"]) if r["mtime"] else None
        res.append(r)
    res.sort(key=lambda r: r["mtime"], reverse=True)
    lines = [f"{human(r['size']):>10}  {(r['mtime_local'] or '')[:19]:19}  {r['key']}"
             + (f"  [{', '.join(r['tags'])}]" if r.get("tags") else "")
             + (f"  — {r['summary']}" if r.get("summary") else "") for r in res]
    lines.append(f"-- {len(res)} match(es){' (from local index)' if use_index else ''}")
    emit(a, res, lines)


def cmd_index(b, a):
    prefix = norm(a.prefix)
    objs = [o for o in listing(b, prefix) if not o.key.endswith("/")]
    with locked_json(INDEX_FILE, {}) as data:
        old = data.get(BUCKET, {}).get("objects", {})
        new = {k: v for k, v in old.items() if not k.startswith(prefix)}
        for o in objs:
            ent = {"size": o.size, "mtime": o.last_modified}
            for f in ("tags", "summary"):
                if old.get(o.key, {}).get(f):
                    ent[f] = old[o.key][f]
            new[o.key] = ent
        data[BUCKET] = {"updated": dt.datetime.now().astimezone().isoformat(timespec="seconds"), "objects": new}
    print(f"index rebuilt: {len(objs)} object(s) under oss://{BUCKET}/{prefix}  ({INDEX_FILE})")


def cmd_tag(b, a):
    key = norm(a.key)
    try:
        h = retry(lambda: b.head_object(key), what=f"head {key}")
    except oss2.exceptions.NotFound:
        raise Fail(f"not found: oss://{BUCKET}/{key}", 3)
    with locked_json(INDEX_FILE, {}) as data:
        ent = data.setdefault(BUCKET, {"updated": None, "objects": {}})["objects"].setdefault(key, {})
        ent.update(size=h.content_length, mtime=h.last_modified)
        tags = [] if a.replace else ent.get("tags", [])
        ent["tags"] = sorted(set(tags) | set(a.tags))
        if a.summary is not None:
            ent["summary"] = a.summary
    print(f"tagged {key}: {', '.join(ent['tags'])}" + (f" — {ent.get('summary')}" if ent.get("summary") else ""))


def cmd_share(b, a):
    if a.key == "ls":
        shares = [s for s in read_json(SHARES_FILE, []) if s.get("bucket") == BUCKET]
        now = time.time()
        for s in shares:
            s["status"] = "active" if s["expires"] > now else "expired"
        emit(a, shares, [f"{s['status']:<8} expires {ts(s['expires'])}  {s['key']}" for s in shares]
             + [f"-- {len(shares)} share(s); re-sign with `oss.py share <key>`"])
        return
    key = norm(a.key)
    if not exists(b, key):
        raise Fail(f"not found: oss://{BUCKET}/{key}", 3)
    days = min(max(a.days, 1), MAX_SHARE_DAYS)
    secs = days * 86400
    url = b.sign_url("GET", key, secs, slash_safe=True)
    now = time.time()
    with locked_json(SHARES_FILE, []) as shares:
        shares.append({"bucket": BUCKET, "key": key, "created": int(now), "expires": int(now + secs), "days": days})
    log_op("share", [key], days=days)
    emit(a, {"key": key, "expires": int(now + secs), "expires_local": ts(now + secs), "url": url},
         [f"expires: {ts(now + secs)}", url])


def cmd_sync(b, a):
    local, prefix = a.local, norm(a.prefix).rstrip("/") + "/"
    if prefix == "/":
        raise Fail("give a non-empty prefix to sync with", 2)
    if a.direction in ("up", "both") and not os.path.isdir(local):
        raise Fail(f"local dir not found: {local}", 3)
    if a.delete and a.direction == "both":
        raise Fail("--delete is only allowed with --direction up or down", 2)
    os.makedirs(local, exist_ok=True) if not a.dry_run else None
    L = {}
    if os.path.isdir(local):
        for root, _, files in os.walk(local):
            for f in files:
                p = os.path.join(root, f)
                st = os.stat(p)
                L[os.path.relpath(p, local).replace(os.sep, "/")] = (p, st.st_size, st.st_mtime)
    R = {o.key[len(prefix):]: o for o in listing(b, prefix) if not o.key.endswith("/")}
    tol = 2
    ups, downs, conflicts, del_remote, del_local = [], [], [], [], []
    for rel in sorted(set(L) | set(R)):
        l, r = L.get(rel), R.get(rel)
        if l and not r:
            (ups if a.direction in ("up", "both") else del_local if a.delete else []).append(rel)
            continue
        if r and not l:
            (downs if a.direction in ("down", "both") else del_remote if a.delete else []).append(rel)
            continue
        rm_ = r.last_modified
        if l[1] == r.size:
            rm_ = remote_mtime(b, r.key, r.last_modified)
            if abs(l[2] - rm_) <= tol:
                continue
        elif a.direction == "both":
            rm_ = remote_mtime(b, r.key, r.last_modified)
        if a.direction == "up":
            ups.append(rel)
        elif a.direction == "down":
            downs.append(rel)
        elif l[2] > rm_ + tol:
            ups.append(rel)
        elif rm_ > l[2] + tol:
            downs.append(rel)
        else:
            conflicts.append(rel)
    plan = {"upload": ups, "download": downs, "delete_remote": del_remote,
            "delete_local": del_local, "conflicts": conflicts}
    for k, v in plan.items():
        for rel in v:
            print(f"{'[dry-run] ' if a.dry_run else ''}{k:<13} {rel}")
    if a.dry_run:
        print("-- dry run: " + ", ".join(f"{k} {len(v)}" for k, v in plan.items()))
        return
    need_yes(len(del_remote) + len(del_local), a, "sync --delete")
    done = {}
    for rel in ups:
        done[prefix + rel] = upload_file(b, L[rel][0], prefix + rel)
    for rel in downs:
        o = R[rel]
        download_file(b, o.key, os.path.join(local, *rel.split("/")), remote_mtime(b, o.key, o.last_modified))
    if done:
        index_update(set_=done)
    if del_remote:                                        # remote deletions go to trash, never purged
        objs = [R[r] for r in del_remote]
        tdir = trash_dest(b, [o.key for o in objs])
        transfer(b, [(o, tdir + o.key) for o in objs], True)
        index_update(delete=[o.key for o in objs])
    for rel in del_local:
        os.remove(L[rel][0])
    log_op("sync", list(done.keys()) + [prefix + r for r in downs + del_remote], direction=a.direction,
           uploaded=len(ups), downloaded=len(downs), trashed_remote=len(del_remote), deleted_local=len(del_local))
    print("-- synced: " + ", ".join(f"{k} {len(v)}" for k, v in plan.items()))


def versioning(b):
    try:
        st = retry(lambda: b.get_bucket_versioning(), what="get versioning").status
    except oss2.exceptions.AccessDenied:
        raise Fail("no permission to read bucket versioning status", 1)
    return st or "Off"


def cmd_versions(b, a):
    key = norm(a.key)
    st = versioning(b)
    if st == "Off":
        raise Fail(f"versioning is OFF on bucket {BUCKET}: no history kept. Enable it in the Aliyun console "
                   "(Bucket > Redundancy for Fault Tolerance > Versioning) to keep old versions.", 6)
    out, km, vm = [], "", ""
    while True:
        r = retry(lambda: b.list_object_versions(prefix=key, key_marker=km, versionid_marker=vm, max_keys=1000),
                  what="list versions")
        out += [{"version_id": v.versionid, "latest": v.is_latest, "size": v.size, "mtime": v.last_modified,
                 "mtime_local": ts(v.last_modified), "delete_marker": False} for v in r.versions if v.key == key]
        out += [{"version_id": m.versionid, "latest": m.is_latest, "size": 0, "mtime": m.last_modified,
                 "mtime_local": ts(m.last_modified), "delete_marker": True} for m in r.delete_marker if m.key == key]
        if not r.is_truncated:
            break
        km, vm = r.next_key_marker, r.next_versionid_marker
    out.sort(key=lambda v: v["mtime"], reverse=True)
    emit(a, {"versioning": st, "key": key, "versions": out},
         [f"versioning: {st}"] + [f"{'*' if v['latest'] else ' '} {v['version_id']}  {v['mtime_local']}  "
                                   + ("DELETE MARKER" if v["delete_marker"] else human(v["size"])) for v in out])


def cmd_restore_version(b, a):
    key = norm(a.key)
    if versioning(b) == "Off":
        raise Fail(f"versioning is OFF on bucket {BUCKET}; there are no old versions to restore", 6)
    retry(lambda: b.copy_object(BUCKET, key, key, params={"versionId": a.version_id}), what="restore version")
    log_op("restore-version", [key], version_id=a.version_id)
    print(f"restored {key} to version {a.version_id} (saved as the new latest version)")


# ---------------------------------------------------------------- CLI
def build():
    js = argparse.ArgumentParser(add_help=False)
    js.add_argument("--json", action="store_true", help="machine-readable output")
    yes = argparse.ArgumentParser(add_help=False)
    yes.add_argument("--yes", action="store_true", help=f"confirm batches > {BATCH_LIMIT} objects")
    ow = argparse.ArgumentParser(add_help=False)
    ow.add_argument("--overwrite", action="store_true", help="allow replacing existing destination objects/files")
    p = argparse.ArgumentParser(prog="oss.py", description=f"Drive for oss://{BUCKET} ({ENDPOINT})")
    sp = p.add_subparsers(dest="cmd", required=True)

    s = sp.add_parser("ls", parents=[js], help="list a directory"); s.add_argument("prefix", nargs="?", default="")
    s.add_argument("-r", "--recursive", action="store_true"); s.add_argument("--sort", choices=["name", "size", "time"], default="name")
    s = sp.add_parser("stat", parents=[js], help="object details"); s.add_argument("key")
    s = sp.add_parser("du", parents=[js], help="space used"); s.add_argument("prefix", nargs="?", default="")
    s = sp.add_parser("put", parents=[ow], help="upload file or dir"); s.add_argument("local"); s.add_argument("key")
    s = sp.add_parser("get", parents=[ow], help="download key or prefix/"); s.add_argument("key"); s.add_argument("local")
    for n in ("cp", "mv"):
        s = sp.add_parser(n, parents=[ow, yes], help=f"{n} key or prefix"); s.add_argument("src"); s.add_argument("dst")
    s = sp.add_parser("mkdir", help="create a directory marker"); s.add_argument("prefix")
    s = sp.add_parser("rm", parents=[yes], help="move to trash (or --purge)"); s.add_argument("key")
    s.add_argument("--purge", action="store_true", help="delete permanently, skip trash")
    s = sp.add_parser("trash", help="trash ls|restore|empty"); ts_ = s.add_subparsers(dest="tcmd", required=True)
    t = ts_.add_parser("ls", parents=[js]); t.add_argument("--prefix", help="only original keys under this prefix")
    t = ts_.add_parser("restore", parents=[ow, yes]); t.add_argument("key"); t.add_argument("--date", help="YYYY-MM-DD deletion day")
    t = ts_.add_parser("empty", parents=[yes]); t.add_argument("--older-than", type=int, default=30, help="days (0 = everything)")
    t.add_argument("--prefix", help="only original keys under this prefix")
    s = sp.add_parser("find", parents=[js], help="search objects"); s.add_argument("keyword", nargs="?")
    s.add_argument("--prefix", default=""); s.add_argument("--ext", help="comma list, e.g. mp4,pdf")
    s.add_argument("--since"); s.add_argument("--until"); s.add_argument("--min"); s.add_argument("--max")
    s.add_argument("--tag", nargs="+"); s.add_argument("--text", help="words to match in key/summary/tags (index)")
    s.add_argument("--index", action="store_true", help="search local index instead of live listing")
    s.add_argument("--include-trash", action="store_true")
    s = sp.add_parser("index", help="local index maintenance"); i = s.add_subparsers(dest="icmd", required=True)
    i = i.add_parser("rebuild"); i.add_argument("prefix", nargs="?", default="")
    s = sp.add_parser("tag", help="tag/summarize an object in the index"); s.add_argument("key"); s.add_argument("tags", nargs="*")
    s.add_argument("--summary"); s.add_argument("--replace", action="store_true", help="replace tags instead of adding")
    s = sp.add_parser("share", parents=[js], help="signed URL, or `share ls`"); s.add_argument("key")
    s.add_argument("--days", type=int, default=MAX_SHARE_DAYS)
    s = sp.add_parser("sync", parents=[yes], help="sync local dir with prefix"); s.add_argument("local"); s.add_argument("prefix")
    s.add_argument("--direction", choices=["up", "down", "both"], default="up")
    s.add_argument("--dry-run", action="store_true"); s.add_argument("--delete", action="store_true")
    s = sp.add_parser("versions", parents=[js], help="list versions"); s.add_argument("key")
    s = sp.add_parser("restore-version", help="restore an old version"); s.add_argument("key"); s.add_argument("version_id")
    return p


CMDS = {"ls": cmd_ls, "stat": cmd_stat, "du": cmd_du, "put": cmd_put, "get": cmd_get, "cp": cmd_cp, "mv": cmd_mv,
        "mkdir": cmd_mkdir, "rm": cmd_rm, "trash": cmd_trash, "find": cmd_find, "index": cmd_index, "tag": cmd_tag,
        "share": cmd_share, "sync": cmd_sync, "versions": cmd_versions, "restore-version": cmd_restore_version}


def main():
    a = build().parse_args()
    try:
        CMDS[a.cmd](bucket(), a)
    except Fail as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(e.code)
    except oss2.exceptions.NotFound as e:
        print(f"ERROR: not found ({e.code})", file=sys.stderr)
        sys.exit(3)
    except oss2.exceptions.OssError as e:
        print(f"ERROR: OSS {e.status} {e.code}: {e.message}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)


if __name__ == "__main__":
    main()
