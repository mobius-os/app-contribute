#!/usr/bin/env python3
"""Read one public PR and print a link-only Contribute chat block. No writes.

The block is a static snapshot: plain facts plus an intent that opens the exact
PR in Contribute. It carries no action, approval or executable session.
"""
import argparse
import json
import re
import subprocess

REFERENCE = re.compile(r'(?:https://github\.com/)?([A-Za-z0-9_.-]{1,100})/([A-Za-z0-9_.-]{1,100})(?:#|/pull/)([1-9][0-9]{0,9})/?')
TEXT_LIMIT = 240


def bounded(text, limit=TEXT_LIMIT):
  text = ' '.join(str(text).split())
  return text if len(text) <= limit else text[:limit - 1].rstrip() + '…'


def gh_read(path):
  result = subprocess.run(['gh', 'api', path], capture_output=True, text=True, check=True, timeout=60)
  return json.loads(result.stdout)


def pull_block(reference, read=gh_read):
  match = REFERENCE.fullmatch(reference.strip())
  if not match or any(re.fullmatch(r'\.+', part) for part in match.groups()[:2]):
    raise ValueError('Use owner/repository#123 or a GitHub pull-request URL.')
  repo, number = f'{match[1]}/{match[2]}', int(match[3])
  pr = read(f'repos/{repo}/pulls/{number}')
  canonical = pr['base']['repo']['full_name']
  if canonical.lower() != repo.lower() or pr.get('number') != number:
    raise ValueError('This PR moved. Read its current repository before sharing it.')
  url = f'https://github.com/{canonical}/pull/{number}'
  state = 'Merged' if pr.get('merged') else 'Closed' if pr.get('state') == 'closed' else 'Draft' if pr.get('draft') else 'Open'
  files, additions, deletions = pr.get('changed_files', 0), pr.get('additions', 0), pr.get('deletions', 0)
  labels = ', '.join(label['name'] for label in pr.get('labels', []) if label.get('name')) or 'None'
  return {
    'app': 'contribute',
    'intent': f'pull-request:{canonical}#{number}',
    'title': bounded(pr['title']),
    'inline': False,
    'facts': [
      {'label': 'Pull request', 'value': f'{canonical}#{number}', 'href': url},
      {'label': 'State', 'value': state},
      {'label': 'Author', 'value': bounded((pr.get('user') or {}).get('login') or 'Unknown')},
      {'label': 'Change', 'value': f'{files} {"file" if files == 1 else "files"} · +{additions} −{deletions}'},
      {'label': 'Labels', 'value': bounded(labels)},
    ],
  }


def main():
  parser = argparse.ArgumentParser(description=__doc__)
  parser.add_argument('pr', help='owner/repository#123 or a GitHub pull-request URL')
  block = pull_block(parser.parse_args().pr)
  print('```mobius-app\n' + json.dumps(block, ensure_ascii=False) + '\n```')


if __name__ == '__main__':
  main()
