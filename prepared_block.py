#!/usr/bin/env python3
"""Print the transcript block for one prepared contribution. No writes.

The block names only the ledger record. It renders as a GitHub-style PR row
whose title opens the record in the Contribute app (with its full toolbar)
and whose Contribute button opens
Contribute's live view of it in the chat with the send confirmation shown;
Contribute's own checks decide whether it can send. The
`pull` row and `facts` are only a snapshot (facts serve older chat views).
Several ids print one batch block: each record as its own row, with one
own Contribute button and one "Contribute all" that confirms once and then
sends every ready item in parallel.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

from agent_snapshot import find_ledger

RECORD_ID = re.compile(r'[A-Za-z0-9][A-Za-z0-9_.-]{0,127}')
VERDICTS = {'all_clear': 'All clear', 'changes_needed': 'Changes needed', 'reviewing': 'Reviewing'}
TONES = {'all_clear': 'success', 'changes_needed': 'danger', 'reviewing': 'attention'}
REPO = re.compile(r'[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}')


def gh_json(path):
  """Best-effort read-only GitHub read; the block works without it."""
  try:
    out = subprocess.run(['gh', 'api', path], capture_output=True, text=True, check=True, timeout=20)
    return json.loads(out.stdout)
  except (OSError, subprocess.SubprocessError, ValueError):
    return None
STAT = re.compile(r'(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?')


def read_record(record_id, ledger=None):
  if not RECORD_ID.fullmatch(record_id or ''):
    raise ValueError('Use the prepared record id from Contribute.')
  ledger = Path(ledger) if ledger else find_ledger()
  for name in (f'{record_id}.json', f'{record_id}.record.json'):
    path = ledger / name
    if path.is_file():
      record = json.loads(path.read_text(encoding='utf-8'))
      if isinstance(record, dict) and record.get('id') == record_id:
        return record
  raise ValueError(f'No contribution {record_id} in the Contribute ledger.')


def stack_layers(record, ledger):
  stack = (record.get('plan') or {}).get('stack')
  if not isinstance(stack, dict) or not stack.get('id') or ledger is None:
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


def prepared_block(record, ledger=None, read=gh_json):
  plan = record.get('plan') if isinstance(record.get('plan'), dict) else {}
  if record.get('status') != 'prepared' or plan.get('action') not in ('pr', 'pr_update'):
    raise ValueError('Only a prepared pull request or pull-request update has a Send block.')
  repo = plan.get('repo') or record.get('repo') or ''
  number = record.get('number')
  updating = plan.get('action') == 'pr_update'
  facts = [{'label': 'Repository', 'value': repo or 'Unknown'},
    {'label': 'Action', 'value': f'Update PR #{number}' if updating and number else 'Update PR' if updating else 'New PR'}]
  stat = STAT.search(str(plan.get('diff_stat') or ''))
  if stat:
    files = int(stat[1])
    facts.append({'label': 'Change', 'value': f'{files} {"file" if files == 1 else "files"} · +{stat[2] or 0} −{stat[3] or 0}'})
  review = record.get('quality_review') if isinstance(record.get('quality_review'), dict) else {}
  verdict = review.get('state')
  if verdict == 'all_clear' and review.get('reviewed_head_sha') != plan.get('head_sha'):
    verdict = None  # a verdict for an older head does not cover this one
  facts.append({'label': 'Review', 'value': VERDICTS.get(verdict, 'Not reviewed')})
  if REPO.fullmatch(repo):
    facts[0]['href'] = f'https://github.com/{repo}'
  pull = {'repo': repo, 'state': 'proposed',
    'badges': [{'label': VERDICTS.get(verdict, 'Not reviewed'), 'tone': TONES.get(verdict, 'neutral')}]}
  if updating and isinstance(number, int) and number > 0:
    pull.update(state='open', number=number, url=f'https://github.com/{repo}/pull/{number}')
  if stat:
    pull.update(files=int(stat[1]), additions=int(stat[2] or 0), deletions=int(stat[3] or 0))
  label_names = [name for name in plan.get('labels') or [] if isinstance(name, str) and name.strip()][:4]
  if label_names and REPO.fullmatch(repo):
    colors = {item.get('name'): item.get('color') for item in (read(f'repos/{repo}/labels?per_page=100') or []) if isinstance(item, dict)}
    pull['labels'] = [{'name': name, **({'color': colors[name]} if colors.get(name) else {})} for name in label_names]
  me = read('user') or {}
  if isinstance(me.get('login'), str):
    pull['author'] = me['login']
  layers = stack_layers(record, ledger)
  waiting = [layer for layer in layers if layer.get('status') == 'prepared']
  if len(layers) > 1:
    pull['badges'].append({'label': f'{len(layers)} linked PRs', 'tone': 'neutral'})
  # The block's own intent is only the title link, so it opens the record in
  # the full app; the in-chat view opens through the action.
  block = {'app': 'contribute', 'intent': f'review:{record["id"]}',
    'title': plan.get('title') or record.get('title') or 'Prepared contribution',
    'inline': True, 'height': 600, 'pull': pull, 'facts': facts}
  if verdict == 'all_clear' and (len(layers) < 2 or waiting):
    block['action'] = {'label': 'Contribute', 'intent': f'chat-send:{record["id"]}'}
  return block


def batch_block(records, ledger=None, read=gh_json):
  """One block for several prepared records (a stack is named by one layer)."""
  if not 2 <= len(records) <= 12:
    raise ValueError('A batch names 2 to 12 prepared records.')
  cache = {}
  def cached(path):
    if path not in cache:
      cache[path] = read(path)
    return cache[path]
  blocks = [prepared_block(record, ledger, cached) for record in records]
  items = [{'title': block['title'], 'intent': block['intent'], 'pull': block['pull'],
    **({'action': block['action']} if 'action' in block else {})} for block in blocks]
  sendable = [record['id'] for record, block in zip(records, blocks) if 'action' in block]
  batch = {'app': 'contribute', 'intent': 'reviews:queue',
    'title': f'{len(records)} contributions ready', 'inline': True, 'height': 640, 'items': items}
  if sendable:
    batch['action'] = {'label': 'Contribute all', 'intent': 'chat-send-batch:' + ','.join(sendable)}
  return batch


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('record_ids', nargs='+')
  parser.add_argument('--ledger-dir', type=Path)
  args = parser.parse_args()
  ledger = args.ledger_dir or find_ledger()
  records = [read_record(record_id, ledger) for record_id in args.record_ids]
  block = prepared_block(records[0], ledger) if len(records) == 1 else batch_block(records, ledger)
  print('```mobius-app\n' + json.dumps(block, ensure_ascii=False) + '\n```')


if __name__ == '__main__':
  main()
