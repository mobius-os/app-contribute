#!/usr/bin/env python3
"""Print the chat card for one or more prepared contributions. No writes.

The card names ledger records only. Its facts are a snapshot from this read;
when the owner taps Contribute (or Contribute all), Contribute re-reads the
records, checks they are reviewed and current, and shows the exact changes on
the same button as Confirm. Nothing is sent before that Confirm. Independent
contributions are sent in parallel; the layers of one stack are sent in order.
"""
import argparse
import json
import re
from pathlib import Path

from agent_snapshot import find_ledger

RECORD_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}')
REPO = re.compile(r'[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}')
STAT = re.compile(r'(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?')
VERDICTS = {'all_clear': 'All clear', 'changes_needed': 'Changes needed', 'reviewing': 'Reviewing'}
MAX_BATCH = 12
TEXT_LIMIT = 240


def bounded(text, limit=TEXT_LIMIT):
  text = ' '.join(str(text).split())
  return text if len(text) <= limit else text[:limit - 1].rstrip() + '…'


def batch_handle(ids):
  """FNV-1a 64 over the sorted ids; chat-blocks.js computes the same handle."""
  value = '\n'.join(['contribute-batch-v1', *sorted(set(ids))])
  digest = 0xcbf29ce484222325
  units = value.encode('utf-16-le')
  for index in range(0, len(units), 2):
    digest ^= units[index] | units[index + 1] << 8
    digest = digest * 0x100000001b3 & 0xFFFFFFFFFFFFFFFF
  return f'{digest:016x}'


def read_record(record_id, ledger):
  if not RECORD_ID.fullmatch(record_id or ''):
    raise ValueError('Use the prepared record id from Contribute.')
  for name in (f'{record_id}.json', f'{record_id}.record.json'):
    path = Path(ledger) / name
    if path.is_file():
      record = json.loads(path.read_text(encoding='utf-8'))
      if isinstance(record, dict) and record.get('id') == record_id:
        return record
  raise ValueError(f'No contribution {record_id} in the Contribute ledger.')


def stack_layers(record, ledger):
  stack = (record.get('plan') or {}).get('stack')
  if not isinstance(stack, dict) or not stack.get('id'):
    return []
  layers = []
  for path in Path(ledger).glob('*.json'):
    try:
      other = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError):
      continue
    if isinstance(other, dict) and ((other.get('plan') or {}).get('stack') or {}).get('id') == stack['id']:
      layers.append(other)
  return layers


def verdict(record):
  plan = record.get('plan') or {}
  review = record.get('quality_review') if isinstance(record.get('quality_review'), dict) else {}
  state = review.get('state')
  # A verdict for an older head does not cover this one.
  return None if state == 'all_clear' and review.get('reviewed_head_sha') != plan.get('head_sha') else state


def prepared_card(record, ledger):
  plan = record.get('plan') if isinstance(record.get('plan'), dict) else {}
  if record.get('status') != 'prepared' or plan.get('action') not in ('pr', 'pr_update'):
    raise ValueError('Only a prepared pull request or pull-request update has a Send card.')
  repo = plan.get('repo') or record.get('repo') or ''
  number = record.get('number')
  facts = [{'label': 'Repository', 'value': bounded(repo or 'Unknown'),
      **({'href': f'https://github.com/{repo}'} if REPO.fullmatch(repo) else {})},
    {'label': 'Action', 'value': f'Update PR #{number}' if plan.get('action') == 'pr_update' and number else 'New PR'}]
  stat = STAT.search(str(plan.get('diff_stat') or ''))
  if stat:
    files = int(stat[1])
    facts.append({'label': 'Change', 'value': f'{files} {"file" if files == 1 else "files"} · +{stat[2] or 0} −{stat[3] or 0}'})
  state = verdict(record)
  facts.append({'label': 'Review', 'value': VERDICTS.get(state, 'Not reviewed')})
  card = {'title': bounded(plan.get('title') or record.get('title') or 'Prepared contribution'),
    'intent': f'review:{record["id"]}', 'facts': facts}
  layers = stack_layers(record, ledger)
  if state == 'all_clear' and (len(layers) < 2 or any(layer.get('status') == 'prepared' for layer in layers)):
    card['action'] = {'label': 'Contribute', 'intent': f'chat-send:{record["id"]}'}
  return card


def card_block(records, ledger):
  if not 1 <= len(records) <= MAX_BATCH:
    raise ValueError(f'A card names 1 to {MAX_BATCH} prepared records.')
  cards = [prepared_card(record, ledger) for record in records]
  if len(cards) == 1:
    return {'app': 'contribute', 'inline': True, 'interaction': 'inline', **cards[0]}
  block = {'app': 'contribute', 'intent': 'reviews:queue', 'title': f'{len(cards)} contributions ready',
    'inline': True, 'interaction': 'inline', 'items': cards}
  sendable = [record['id'] for record, card in zip(records, cards) if 'action' in card]
  if len(sendable) >= 2:
    block['action'] = {'label': 'Contribute all', 'intent': f'chat-send-batch:{batch_handle(sendable)}'}
  return block


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('record_ids', nargs='+')
  parser.add_argument('--ledger-dir', type=Path)
  args = parser.parse_args()
  ledger = args.ledger_dir or find_ledger()
  block = card_block([read_record(record_id, ledger) for record_id in args.record_ids], ledger)
  print('```mobius-app\n' + json.dumps(block, ensure_ascii=False) + '\n```')


if __name__ == '__main__':
  main()
