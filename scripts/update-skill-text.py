"""Idempotently refresh skill-card text that changed in a newer Global/TWN client.

data/skill-text-updates.json lists, per card, the old and the new description body
(generated with the same formatter the site was built with). Only the description
paragraph and the searchable data-text of the listed cards are touched.

    python scripts/update-skill-text.py          # rewrite index.html
    python scripts/update-skill-text.py --check  # exit 1 if a listed card is not up to date
"""
import argparse
import html
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
JOB_RE = r'(<section class="job-section" data-job="{job}"[\s\S]*?)(?=<section class="job-section"|<div id="skill-preview-popover")'
CARD_RE = r'<article class="skill-card\b[\s\S]*?</article>'


def body(value):
    return html.escape(value).replace('\n', '<br>')


def searchable(value):
    return html.escape(value).lower()


def apply(text, entry):
    section = re.search(JOB_RE.format(job=re.escape(entry['job'])), text)
    assert section, entry['job']
    block = section.group(1)
    matches = [m for m in re.finditer(CARD_RE, block)
               if f'<h3>{html.escape(entry["name"])}</h3>' in m.group(0)
               and f'data-stage="{entry["stage"]}"' in m.group(0) and f'data-core="{entry["core"]}"' in m.group(0)]
    assert len(matches) == 1, (entry['job'], entry['name'], len(matches))
    card = matches[0].group(0)
    old_body, new_body = body(entry['old_full']), body(entry['new_full'])
    if new_body in card:
        return text, False
    assert card.count(old_body) == 1, ('description not found', entry['job'], entry['name'])
    updated = card.replace(old_body, new_body)
    old_search, new_search = searchable(entry['old_full']), searchable(entry['new_full'])
    head, attr, tail = re.match(r'([\s\S]*?data-text=")([^"]*)("[\s\S]*)', updated).groups()
    assert old_search in attr, ('search text not found', entry['job'], entry['name'])
    updated = head + attr.replace(old_search, new_search) + tail
    start = section.start(1) + matches[0].start()
    return text[:start] + updated + text[start + len(card):], True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data = json.loads((ROOT / 'data/skill-text-updates.json').read_text(encoding='utf8'))
    path = ROOT / 'index.html'
    text = path.read_text(encoding='utf8')
    changed = 0
    for entry in data['cards']:
        text, did = apply(text, entry)
        changed += did
    if args.check:
        if changed:
            print(f'{changed} card(s) are not up to date with data/skill-text-updates.json')
            sys.exit(1)
        print(f'OK: {len(data["cards"])} card(s) up to date')
        return
    if changed:
        path.write_text(text, encoding='utf8', newline='\n')
    print(json.dumps({'cards': len(data['cards']), 'changed': changed}))


if __name__ == '__main__':
    main()
