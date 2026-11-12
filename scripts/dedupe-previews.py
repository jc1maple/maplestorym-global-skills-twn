"""Store one copy of every animation preview that is byte-identical across job folders.

Common V skills were exported once per job (e.g. 49 copies of V_DecentHolyFountain_01.png).
Every group of identical files with the same file name moves to animations/common/<name>;
index.html and animations/preview_manifest.json are rewritten to point at the shared copy.
Idempotent: a second run finds nothing to move.

    python scripts/dedupe-previews.py           # move files and rewrite references
    python scripts/dedupe-previews.py --check   # exit 1 if duplicates remain or a reference is broken
"""
import argparse
import hashlib
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ANIM = ROOT / 'animations'
COMMON = ANIM / 'common'


def scan():
    groups = defaultdict(list)
    for path in sorted(ANIM.rglob('*')):
        if path.is_file() and path.suffix.lower() in {'.png', '.mp4', '.webp'}:
            groups[(path.name, hashlib.sha256(path.read_bytes()).hexdigest())].append(path)
    return groups


def referenced(text):
    return set(re.findall(r'animations/[^"?&\s<>]+\.(?:png|mp4|webp)', text))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    index = ROOT / 'index.html'
    text = index.read_text(encoding='utf8')
    manifest_path = ANIM / 'preview_manifest.json'
    manifest = manifest_path.read_text(encoding='utf8')
    groups = scan()
    names = defaultdict(set)
    for (name, digest) in groups:
        names[name].add(digest)

    moves = {}
    for (name, digest), paths in groups.items():
        outside = [p for p in paths if p.parent != COMMON]
        if len(paths) < 2 or not outside:
            continue
        target = COMMON / name
        if target.exists() and target not in paths:
            continue  # a different file already owns that shared name; leave this group alone
        for path in outside:
            moves[path.relative_to(ROOT).as_posix()] = target.relative_to(ROOT).as_posix()

    missing = sorted(ref for ref in referenced(text) if not (ROOT / ref).exists() and ref not in moves)
    if args.check:
        if moves or missing:
            print(f'{len(moves)} duplicate file(s) to merge, {len(missing)} broken reference(s)', missing[:5])
            sys.exit(1)
        print(f'OK: {sum(len(v) for v in groups.values())} preview files, no duplicates, all references resolve')
        return

    saved = 0
    COMMON.mkdir(exist_ok=True)
    pattern = re.compile('|'.join(re.escape(old) for old in sorted(moves, key=len, reverse=True))) if moves else None
    if pattern:
        text = pattern.sub(lambda m: moves[m.group(0)], text)
        manifest = pattern.sub(lambda m: moves[m.group(0)], manifest)
    for old, new in moves.items():
        source, target = ROOT / old, ROOT / new
        if target.exists():
            saved += source.stat().st_size
            source.unlink()
        else:
            source.rename(target)
    assert not [ref for ref in referenced(text) if not (ROOT / ref).exists()], 'broken preview reference'
    json.loads(manifest)
    index.write_text(text, encoding='utf8', newline='\n')
    manifest_path.write_text(manifest, encoding='utf8', newline='\n')
    print(json.dumps({'merged_files': len(moves), 'shared_files': len(set(moves.values())), 'saved_mb': round(saved / 1e6)}))


if __name__ == '__main__':
    main()
