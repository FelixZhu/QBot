#!/usr/bin/env python3
"""Upload a file to Qian's Aliyun OSS bucket and print a signed download URL.

Usage:
  oss_upload.py <local_file> <object_key> [--days N] [--check]
  oss_upload.py --sign <object_key> [--days N]
Credentials come from OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET (never printed).
"""
import argparse, os, sys, time
import oss2

ENDPOINT = os.environ.get("OSS_ENDPOINT", "https://oss-cn-beijing.aliyuncs.com")
BUCKET = os.environ.get("OSS_BUCKET", "qian-grokbot")
RESUME_DIR = os.path.expanduser("~/.oss_resume")


def bucket():
    kid, sec = os.environ.get("OSS_ACCESS_KEY_ID"), os.environ.get("OSS_ACCESS_KEY_SECRET")
    if not kid or not sec:
        sys.exit("ERROR: OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET not set")
    return oss2.Bucket(oss2.Auth(kid, sec), ENDPOINT, BUCKET, connect_timeout=600)


def sign(b, key, days):
    secs = min(max(days, 1), 7) * 24 * 3600
    url = b.sign_url("GET", key, secs, slash_safe=True)
    exp = time.strftime("%Y-%m-%d %H:%M %Z", time.localtime(time.time() + secs))
    print(f"expires: {exp}")
    print(url)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("args", nargs="+")
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--check", action="store_true", help="only report whether the key exists")
    p.add_argument("--sign", action="store_true", help="re-sign an existing key, no upload")
    a = p.parse_args()
    b = bucket()

    if a.sign:
        key = a.args[0]
        if not b.object_exists(key):
            sys.exit(f"ERROR: oss://{BUCKET}/{key} does not exist")
        sign(b, key, a.days)
        return

    if len(a.args) != 2:
        sys.exit("usage: oss_upload.py <local_file> <object_key>")
    path, key = a.args
    if a.check:
        print("exists" if b.object_exists(key) else "absent", f"oss://{BUCKET}/{key}")
        return
    if not os.path.isfile(path):
        sys.exit(f"ERROR: local file not found: {path}")
    if b.object_exists(key):
        sys.exit(f"ERROR: oss://{BUCKET}/{key} already exists; pick another key")

    size = os.path.getsize(path)
    store = oss2.ResumableStore(root=RESUME_DIR)
    for i in range(8):
        try:
            oss2.resumable_upload(b, key, path, store=store,
                                  part_size=4 * 1024 * 1024, num_threads=3)
            break
        except Exception as e:  # network hiccups: retry, resume from checkpoint
            print(f"retry {i + 1}/8: {repr(e)[:200]}", flush=True)
            time.sleep(min(5 * (i + 1), 30))
    else:
        sys.exit("ERROR: upload failed after 8 attempts")
    print(f"uploaded: oss://{BUCKET}/{key} ({size / 1024 / 1024:.1f} MB)")
    sign(b, key, a.days)


if __name__ == "__main__":
    main()
