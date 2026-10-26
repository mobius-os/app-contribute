import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT))
spec = importlib.util.spec_from_file_location('prepared_block', ROOT / 'prepared_block.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

HEAD = 'a' * 40


def record(record_id, **extra):
  plan = {'action': 'pr', 'repo': 'owner/repo', 'title': f'Change {record_id}', 'branch': f'fix/{record_id}',
    'head_sha': HEAD, 'diff_stat': '2 files changed, 4 insertions(+), 1 deletion(-)', **extra.pop('plan', {})}
  return {'id': record_id, 'type': 'pr', 'status': 'prepared', 'repo': 'owner/repo', 'plan': plan,
    'quality_review': {'state': 'all_clear', 'reviewed_head_sha': HEAD}, **extra}


class PreparedBlockTests(unittest.TestCase):
  def setUp(self):
    self.ledger = tempfile.TemporaryDirectory()
    self.addCleanup(self.ledger.cleanup)

  def save(self, *records):
    for item in records:
      (Path(self.ledger.name) / f'{item["id"]}.json').write_text(json.dumps(item))
    return [module.read_record(item['id'], self.ledger.name) for item in records]

  def test_single_card_names_the_record_and_its_send_action_only(self):
    block = module.card_block(self.save(record('one')), self.ledger.name)
    self.assertEqual(block['intent'], 'review:one')
    self.assertEqual(block['action'], {'label': 'Contribute', 'intent': 'chat-send:one'})
    self.assertEqual((block['inline'], block['interaction']), (True, 'inline'))
    self.assertNotIn('pull', block)
    self.assertIn({'label': 'Change', 'value': '2 files · +4 −1'}, block['facts'])
    self.assertIn({'label': 'Review', 'value': 'All clear'}, block['facts'])

  def test_a_verdict_for_another_head_offers_no_send(self):
    stale = record('one', quality_review={'state': 'all_clear', 'reviewed_head_sha': 'b' * 40})
    block = module.card_block(self.save(stale), self.ledger.name)
    self.assertNotIn('action', block)
    self.assertIn({'label': 'Review', 'value': 'Not reviewed'}, block['facts'])

  def test_batch_uses_a_short_handle_bound_to_its_listed_sendable_records(self):
    long_ids = [f'record-{"x" * 110}-{n}' for n in range(3)]
    records = self.save(*(record(item) for item in long_ids), record('unreviewed', quality_review={}))
    block = module.card_block(records, self.ledger.name)
    self.assertEqual([item['action']['intent'] for item in block['items'] if 'action' in item], [f'chat-send:{item}' for item in long_ids])
    self.assertEqual(block['action'], {'label': 'Contribute all', 'intent': f'chat-send-batch:{module.batch_handle(long_ids)}'})
    self.assertLessEqual(len(block['action']['intent']), 32)

  def test_handle_matches_the_app(self):
    # chat-blocks.js: batchHandle(['b', 'a']) === '968bcf1a16b2b0ee'
    self.assertEqual(module.batch_handle(['b', 'a']), '968bcf1a16b2b0ee')
    self.assertEqual(module.batch_handle(['a', 'b', 'a']), module.batch_handle(['b', 'a']))

  def test_only_prepared_pull_requests_and_bounded_batches(self):
    with self.assertRaises(ValueError):
      module.card_block(self.save(record('open', status='open')), self.ledger.name)
    with self.assertRaises(ValueError):
      module.card_block(self.save(*(record(f'r{n}') for n in range(13))), self.ledger.name)
    with self.assertRaises(ValueError):
      module.read_record('../escape', self.ledger.name)

  def test_long_titles_fit_the_card(self):
    block = module.card_block(self.save(record('one', plan={'title': 'x' * 300})), self.ledger.name)
    self.assertLessEqual(len(block['title']), 240)


if __name__ == '__main__':
  unittest.main()
