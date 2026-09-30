"""Render HEXA enhancement rules from a pinned Global/TWN export, offline only.

Only HEXA enhancement descriptions are rewritten. Origin/mastery skill values,
icons, animation references and player configuration IDs remain unchanged.
"""
import argparse
import hashlib
import html
import json
import re
import sys
from collections import defaultdict
from decimal import Decimal
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
START = '<!-- hexa-upgrade:start -->'
END = '<!-- hexa-upgrade:end -->'
CARD = re.compile(r'<article class="skill-card\b[\s\S]*?</article>')
COLOR = re.compile(r'\[[0-9a-fA-F]{6}\]|\[-\]')


def clean(text):
    return COLOR.sub('', text).strip()


def number(value):
    return format(Decimal(str(value)).normalize(), 'f')


def export(tables_path, assets, parser_dir):
    sys.path.insert(0, str(parser_dir))
    from parse_twn_language import load_ifo, find_offset, read_message
    profile = json.loads(tables_path.read_text(encoding='utf8'))
    ifo, tbl_path = assets / '7835192.msm', assets / '7853766.msm'
    offsets, collisions, _ = load_ifo(ifo, tbl_path)
    raw = tbl_path.read_bytes()
    # This build's plaintext table has a verified six-byte resource wrapper.
    tbl = raw[6:] if raw.startswith(bytes.fromhex('fefffffe01ff')) else raw
    assert int.from_bytes(tbl[:4], 'little') == 0x4970
    messages = {}

    def message(code):
        if code not in messages:
            _, offset = find_offset(code, offsets, collisions)
            if offset is None:
                raise ValueError(f'Missing TWN translation: {code}')
            messages[code] = clean(read_message(tbl, code, offset))
        return messages[code]

    cores = []
    for row in profile['tables']['HexaMatrix/HexaCoreEnhanceInfo']:
        rules = []
        for family in ('Additional', 'Option', 'PassiveOption'):
            indices = sorted({int(m[1]) for key in row if (m := re.fullmatch(family + r'\[(\d+)\]\.MinLevel', key))})
            for index in indices:
                prefix = f'{family}[{index}]'
                if not row.get(prefix + '.MinLevel'):
                    continue
                if row.get(prefix + '.EnhanceDesc.Use') != 'TRUE':
                    raise ValueError(f'Unexpected hidden rule: {row["Code"]} {prefix}')
                effect = row[prefix + ('.Type' if family == 'Additional' else '.Code')]
                scope = '被動' if family == 'PassiveOption' else ('Buff' if row['EnhanceType'] == 'Buff' else '技能')
                if family == 'Option':
                    scope = 'Buff'
                cycle = int(row.get(prefix + '.EnhanceDesc.LevelCycle') or 0)
                repeat = row[prefix + '.AddPerLevel'] == 'TRUE'
                # All current repeating rules display a one-level cycle. Fail on new formats.
                assert (cycle == 1 or (cycle == 0 and int(row[prefix + '.MinLevel']) == 30)) if repeat else (cycle == 0)
                desc_code = 'HexaSkill_Desc_' + effect + ('_LevelCycle' if cycle else '')
                apply_code = 'HexaSkill_ApplyDesc_' + effect
                rules.append({
                    'family': family, 'effect': effect, 'scope': scope,
                    'minLevel': int(row[prefix + '.MinLevel']), 'perLevel': repeat,
                    'value': int(row[prefix + ('.Value' if family == 'Additional' else '.OptionValue')]),
                    'divide': int(row.get(prefix + '.EnhanceDesc.DivideValue') or 1),
                    'descriptionCode': desc_code, 'description': message(desc_code),
                    'appliedCode': apply_code, 'applied': message(apply_code),
                })
        assert rules, row['Code']
        cores.append({'code': row['Code'], 'enhanceType': row['EnhanceType'],
                      'skills': [v for k, v in row.items() if re.fullmatch(r'Skill\[\d+\]\.Code', k) and v],
                      'rules': rules})
    assert len({c['code'] for c in cores}) == len(cores) == 205
    return {'schemaVersion': 1, 'source': {
        'manifest': profile['source']['manifest'],
        'indexedTables': profile['source']['indexedTables'],
        'stringPool': profile['source']['stringPool'],
        'language': [{'file': p.name, 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in (ifo, tbl_path)],
        'calculation': 'Sum Value * (level - MinLevel + 1) when AddPerLevel; otherwise Value. Apply when level >= MinLevel. Divide by EnhanceDesc.DivideValue for display.',
        'nativeEvidence': 'Global PC EnhanceCoreInfo..ctor RVA 0x65F1EC0; SetEnhanceHexaCoreDescription RVA 0x12BB5B0',
    }, 'coverage': {'enhancementRows': len(cores), 'missingTranslations': []}, 'messages': messages, 'cores': cores}


def totals(core, level):
    result = defaultdict(Decimal)
    for rule in core['rules']:
        if level < rule['minLevel']:
            continue
        count = level - rule['minLevel'] + 1 if rule['perLevel'] else 1
        key = (rule['family'], rule['effect'], rule['scope'], rule['applied'])
        result[key] += Decimal(rule['value']) * count / rule['divide']
    return result


def effect_text(template, value):
    return template.split('{1}', 1)[1].replace('{2}', number(value)).strip()


def render(core):
    esc = html.escape
    lines = []
    for r in core['rules']:
        scope = '' if r['scope'] == '技能' else f'[{r["scope"]}] '
        label = '每升 1 級' if r['perLevel'] and r['minLevel'] < 30 else f'Lv.{r["minLevel"]} 額外'
        if r['perLevel'] and 1 < r['minLevel'] < 30:
            label += f'（自 Lv.{r["minLevel"]} 起）'
        value = Decimal(r['value']) / r['divide']
        lines.append(esc(f'{scope}{label}：{effect_text(r["description"], value)}'))
    applied = totals(core, 30)
    summary = '<br>'.join(esc(('' if key[2] == '技能' else f'[{key[2]}] ') + effect_text(key[3], value)) for key, value in applied.items())
    rows = []
    for level in range(1, 31):
        current, previous = totals(core, level), totals(core, level - 1)
        cumulative = '<br>'.join(esc(('' if key[2] == '技能' else f'[{key[2]}] ') + effect_text(key[3], value)) for key, value in current.items()) or '—'
        delta = '<br>'.join(esc(('' if key[2] == '技能' else f'[{key[2]}] ') + effect_text(key[3], value - previous.get(key, 0))) for key, value in current.items() if value != previous.get(key, 0)) or '—'
        rows.append(f'<tr><th scope="row">{level}</th><td>{delta}</td><td>{cumulative}</td></tr>')
    return (START + f'<section class="hexa-upgrade" data-hexa-core="{esc(core["code"])}">'
            '<h4>HEXA 強化效果</h4><div class="hexa-rules">' + '<br>'.join(lines) + '</div>'
            f'<p class="hexa-total"><strong>Lv.30 累計</strong><br>{summary}</p>'
            '<details class="hexa-levels"><summary>查看每級增量與累計效果（1～30 級）</summary>'
            '<table><caption>本核心的強化增量，不是技能本身的傷害倍率</caption>'
            '<thead><tr><th scope="col">等級</th><th scope="col">本級增加</th><th scope="col">累計效果</th></tr></thead>'
            '<tbody>' + ''.join(rows) + '</tbody></table></details></section>' + END)


def update(text, data):
    cores = {c['code'].lower(): c for c in data['cores']}
    seen = []

    def card(match):
        card_text = match[0]
        key = re.search(r'\benhance_[a-z0-9_]+\b', card_text.split('role="button"')[0], re.I)
        if not key or key[0].lower() not in cores:
            return card_text
        core = cores[key[0].lower()]
        if 'data-stage="lv250"' not in card_text:
            return card_text
        seen.append(core['code'])
        description = re.search(r'<(p|div) class="skill-desc">([\s\S]*?)</\1>\s*</article>', card_text)
        assert description, core['code']
        body = description[2]
        if START in body:
            body = body.split(END, 1)[1]
        else:
            body, count = re.subn(r'^HEXA core enhance type: [^<]+<br>(?:Lv [^<]+<br>)?', '', body)
            assert count == 1, core['code']
        replacement = '<div class="skill-desc">' + render(core) + body + '</div>'
        end = description.end() - len('</article>')
        # Keep the original whitespace before the article's closing tag.
        trailing = re.search(r'\s*$', card_text[description.start():end])[0]
        return card_text[:description.start()] + replacement + trailing + card_text[end:]

    output = CARD.sub(card, text)
    assert len(seen) == len(set(seen)) == len(cores), (len(seen), sorted(set(cores) - {s.lower() for s in seen}))
    assert 'HEXA core enhance type:' not in output
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tables', type=Path)
    parser.add_argument('--assets', type=Path)
    parser.add_argument('--parser-dir', type=Path)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    data_path = ROOT / 'data/hexa-enhancements.json'
    data = export(args.tables, args.assets, args.parser_dir) if args.tables else json.loads(data_path.read_text(encoding='utf8'))
    target = ROOT / 'index.html'
    before = target.read_text(encoding='utf8')
    after = update(before, data)
    assert update(after, data) == after, 'Not idempotent'
    if args.check:
        assert after == before, 'Generated HEXA content is stale'
    else:
        data_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
        target.write_text(after, encoding='utf8', newline='\n')
    print(json.dumps({'cores': len(data['cores']), 'missingTranslations': [], 'changed': before != after}))


if __name__ == '__main__':
    main()
