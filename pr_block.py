#!/usr/bin/env python3
"""Read a public PR and print Contribute's reusable transcript block. No writes."""
import argparse
import json
import re
import subprocess


def pull_block(reference, read=None):
  match = re.fullmatch(r'(?:https://github\.com/)?([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)(?:#|/pull/)([1-9][0-9]*)/?', reference)
  if not match or any(part in {'.', '..'} for part in match[1].split('/')):
    raise ValueError('Use owner/repository#123 or a GitHub pull-request URL.')
  repo, number = match[1], int(match[2])
  if read is None:
    def read(path):
      result = subprocess.run(['gh', 'api', path], capture_output=True, text=True, check=True, timeout=60)
      return json.loads(result.stdout)
  pr = read(f'repos/{repo}/pulls/{number}')
  canonical = pr['base']['repo']['full_name']
  if canonical.lower() != repo.lower() or pr.get('number') != number:
    raise ValueError('This PR moved. Read its current repository before sharing it.')
  state = 'merged' if pr.get('merged') else 'closed' if pr.get('state') == 'closed' else 'draft' if pr.get('draft') else 'open'
  author = pr.get('user', {}).get('login') or None
  files, additions, deletions = pr.get('changed_files', 0), pr.get('additions', 0), pr.get('deletions', 0)
  labels = [{'name': label['name'], **({'color': label['color']} if label.get('color') else {})} for label in pr.get('labels', []) if label.get('name')]
  change = f'{files} {"file" if files == 1 else "files"} · +{additions} −{deletions}'
  return {'app':'contribute', 'intent':f'pull-request:{canonical}#{number}', 'title':pr['title'], 'inline':False,
    # Current Möbius renders `pull` as a GitHub-style PR row; `facts` remain
    # for installations whose chat view predates that row.
    'pull':{'repo':canonical, 'number':number, 'state':state, 'author':author, 'files':files,
      'additions':additions, 'deletions':deletions, 'labels':labels, 'url':f'https://github.com/{canonical}/pull/{number}'},
    'facts':[{'label':'Repository','value':f'{canonical}#{number}','href':f'https://github.com/{canonical}/pull/{number}'},
      {'label':'Author','value':author or 'Unknown'}, {'label':'State','value':state.capitalize()},
      {'label':'Change','value':change}, {'label':'Labels','value':', '.join(label['name'] for label in labels) or 'None'}]}


def main():
  parser=argparse.ArgumentParser(description=__doc__)
  parser.add_argument('pr')
  args=parser.parse_args()
  block=pull_block(args.pr)
  print('```mobius-app\n'+json.dumps(block, ensure_ascii=False)+'\n```')


if __name__ == '__main__':
  main()
