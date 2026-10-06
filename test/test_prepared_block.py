import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).parents[1]))
spec = importlib.util.spec_from_file_location('prepared_block', Path(__file__).parents[1] / 'prepared_block.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

RECORD = {'id': 'rec-1', 'status': 'prepared', 'repo': 'team/repo',
  'plan': {'action': 'pr', 'repo': 'team/repo', 'title': 'Fix the thing',
    'head_sha': 'a' * 40, 'diff_stat': '3 files changed, 53 insertions(+), 49 deletions(-)'},
  'quality_review': {'state': 'all_clear', 'reviewed_head_sha': 'a' * 40}}


def block_for(record, ledger=None, read=lambda _path: None):
  # No network in tests: GitHub reads are injected.
  return module.prepared_block(record, ledger, read)


class PreparedBlockTests(unittest.TestCase):
  def test_block_names_only_the_record_and_opens_inline(self):
    block = block_for(RECORD)
    self.assertEqual(block['intent'], 'review:rec-1')
    self.assertIs(block['inline'], True)
    self.assertNotIn('expand_label', block)
    self.assertIn({'label': 'Change', 'value': '3 files · +53 −49'}, block['facts'])
    self.assertIn({'label': 'Review', 'value': 'All clear'}, block['facts'])
    self.assertNotIn('plan', block)

  def test_verdict_for_an_older_head_is_not_all_clear(self):
    block = block_for({**RECORD, 'quality_review': {'state': 'all_clear', 'reviewed_head_sha': 'b' * 40}})
    self.assertIn({'label': 'Review', 'value': 'Not reviewed'}, block['facts'])

  def test_update_names_the_existing_pull_request(self):
    block = block_for({**RECORD, 'number': 9, 'plan': {**RECORD['plan'], 'action': 'pr_update'}})
    self.assertIn({'label': 'Action', 'value': 'Update PR #9'}, block['facts'])

  def test_public_or_non_pr_records_have_no_send_block(self):
    with self.assertRaises(ValueError):
      block_for({**RECORD, 'status': 'open'})
    with self.assertRaises(ValueError):
      block_for({**RECORD, 'plan': {'action': 'issue'}})

  def test_reads_exact_record_and_refuses_unsafe_ids(self):
    with tempfile.TemporaryDirectory() as tmp:
      Path(tmp, 'rec-1.json').write_text(json.dumps(RECORD))
      self.assertEqual(module.read_record('rec-1', tmp)['id'], 'rec-1')
      with self.assertRaises(ValueError):
        module.read_record('../rec-1', tmp)
      with self.assertRaises(ValueError):
        module.read_record('missing', tmp)


  def test_reviewed_record_renders_as_a_proposed_pr_with_a_send_action(self):
    block = block_for(RECORD)
    self.assertEqual(block['pull'], {'repo': 'team/repo', 'state': 'proposed',
      'badges': [{'label': 'All clear', 'tone': 'success'}], 'files': 3, 'additions': 53, 'deletions': 49})
    self.assertEqual(block['action'], {'label': 'Contribute', 'intent': 'chat-send:rec-1'})
    self.assertIn({'label': 'Repository', 'value': 'team/repo', 'href': 'https://github.com/team/repo'}, block['facts'])

  def test_unreviewed_record_offers_no_send_action(self):
    block = block_for({**RECORD, 'quality_review': {'state': 'changes_needed'}})
    self.assertNotIn('action', block)
    self.assertEqual(block['pull']['badges'], [{'label': 'Changes needed', 'tone': 'danger'}])

  def test_update_points_at_the_open_pull_request(self):
    block = block_for({**RECORD, 'number': 9, 'plan': {**RECORD['plan'], 'action': 'pr_update'}})
    self.assertEqual((block['pull']['state'], block['pull']['number'], block['pull']['url']), ('open', 9, 'https://github.com/team/repo/pull/9'))
    self.assertEqual(block['action']['label'], 'Contribute')

  def test_labels_take_repository_colors_and_author_when_github_answers(self):
    def read(path):
      return [{'name': 'bug', 'color': 'd73a4a'}] if path.startswith('repos/team/repo/labels') else {'login': 'octocat'}
    block = block_for({**RECORD, 'plan': {**RECORD['plan'], 'labels': ['bug', 'area: ui']}}, read=read)
    self.assertEqual(block['pull']['labels'], [{'name': 'bug', 'color': 'd73a4a'}, {'name': 'area: ui'}])
    self.assertEqual(block['pull']['author'], 'octocat')

  def test_a_stack_layer_offers_one_send_for_every_waiting_layer(self):
    stack = lambda position: {'id': 'chain', 'position': position, 'total': 2}
    first = {**RECORD, 'plan': {**RECORD['plan'], 'stack': stack(1)}}
    second = {**RECORD, 'id': 'rec-2', 'plan': {**RECORD['plan'], 'stack': stack(2)}}
    with tempfile.TemporaryDirectory() as tmp:
      for record in (first, second):
        Path(tmp, f"{record['id']}.json").write_text(json.dumps(record))
      block = block_for(first, tmp)
    self.assertEqual(block['action'], {'label': 'Contribute', 'intent': 'chat-send:rec-1'})
    self.assertIn({'label': '2 linked PRs', 'tone': 'neutral'}, block['pull']['badges'])


  def test_batch_lists_each_record_and_sends_only_reviewed_ones_together(self):
    other = {**RECORD, 'id': 'rec-9', 'quality_review': {'state': 'changes_needed'}}
    block = module.batch_block([RECORD, other], None, lambda _path: None)
    self.assertEqual([item['intent'] for item in block['items']], ['review:rec-1', 'review:rec-9'])
    self.assertEqual(block['action'], {'label': 'Contribute all', 'intent': 'chat-send-batch:rec-1'})
    self.assertEqual(block['title'], '2 contributions ready')
    with self.assertRaises(ValueError):
      module.batch_block([RECORD], None, lambda _path: None)


if __name__ == '__main__':
  unittest.main()
