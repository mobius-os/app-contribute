"""Who joins the chat's Send card: exactly the records that can be sent now."""
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

import lifecycle_engine as engine  # noqa: E402
from lifecycle_record import TABLES  # noqa: E402

HEAD, OLD_HEAD = 'a' * 40, 'b' * 40
CHAT = 'chat-1'
PULL = {'number': 5, 'url': 'https://github.com/owner/repo/pull/5'}


def record(record_id, **extra):
  plan = {'action': 'pr', 'repo': 'owner/repo', 'title': f'Change {record_id}', 'branch': f'fix/{record_id}',
    'head_sha': HEAD, 'diff_stat': '2 files changed, 4 insertions(+), 1 deletion(-)', **extra.pop('plan', {})}
  return {'id': record_id, 'type': 'pr', 'status': 'prepared', 'repo': 'owner/repo', 'plan': plan, 'chat_id': CHAT,
    'quality_review': {'state': 'all_clear', 'reviewed_head_sha': HEAD}, **extra}


def update(record_id, **extra):
  """An update to a PR that is already public: the record reads `prepared` while the PR lives."""
  return record(record_id, plan={'action': 'pr_update', **extra.pop('plan', {})}, **PULL, **extra)


def with_lifecycle(item, publication, update_state='NONE', flags=()):
  """A record the engine wrote: the stored vector beside the status word it derives."""
  vector = engine.new_vector(TABLES, {'publication': publication, 'update': update_state, 'followup': 'OFF'}, 1_000_000)
  vector['attention']['flags'] = list(flags)
  status = engine.status_of(TABLES, vector, item['status'])
  return {**item, 'lifecycle': vector, 'status': status}


class CardMembers(unittest.TestCase):
  def setUp(self):
    self.ledger = tempfile.TemporaryDirectory()
    self.addCleanup(self.ledger.cleanup)

  def save(self, *records):
    for item in records:
      (Path(self.ledger.name) / f'{item["id"]}.json').write_text(json.dumps(item))
    return [module.read_record(item['id'], self.ledger.name) for item in records]

  def members(self, *named):
    block = module.card_block(self.save(*named), self.ledger.name, CHAT)
    return [item['intent'] for item in block['items']], block['action']['label']

  def test_a_stuck_record_never_joins_the_card_and_never_turns_send_1_into_send_3(self):
    held = record('held', needs_attention=True, attention={'type': 'checks_failed'})
    failed = record('failed', last_submit_error='The push was refused.')
    unconfirmed = record('unconfirmed', last_submit_stage='push_ambiguous')
    unconfirmed_code = record('unconfirmed-code', last_submit_error_code='publication_unconfirmed')
    self.save(held, failed, unconfirmed, unconfirmed_code)
    intents, label = self.members(record('ok'))
    self.assertEqual(intents, ['review:ok'])
    self.assertEqual(label, 'Send', 'one record can be sent, so the card says Send, not Send 4')

  def test_an_update_waiting_on_a_public_pull_request_joins_like_any_ready_record(self):
    self.save(update('update'))
    self.assertEqual(self.members(record('ok')), (['review:ok', 'review:update'], 'Send 2'))

  def test_a_refused_update_does_not_join_and_neither_does_one_whose_send_is_unconfirmed(self):
    # The refusal of a second update after a first one that pushed an older version: not a lost send, but it
    # carries its error, so it waits for a fix instead of joining the card.
    refused = update('refused', last_submit_stage='pushed', last_submit_push_sha=OLD_HEAD,
      last_submit_error='This update changed since it was prepared. Nothing was pushed.')
    lost = update('lost', last_submit_stage='push_ambiguous')
    self.save(refused, lost)
    self.assertEqual(self.members(record('ok')), (['review:ok'], 'Send'))

  def test_a_record_the_engine_wrote_with_an_attention_flag_waits_behind_it(self):
    flagged = with_lifecycle(record('flagged'), 'PREPARED', flags=['checks_failed'])
    clear = with_lifecycle(record('clear'), 'PREPARED')
    update_flagged = with_lifecycle(update('update-flagged', status='prepared'), 'OPEN', 'PREPARED_UPDATE', flags=['merge_conflict'])
    self.save(flagged, clear, update_flagged)
    self.assertEqual(self.members(record('ok')), (['review:ok', 'review:clear'], 'Send 2'))

  def test_a_record_that_is_no_longer_waiting_to_be_sent_never_joins(self):
    sending = with_lifecycle(record('sending'), 'SENDING')
    not_confirmed = with_lifecycle(record('not-confirmed', last_submit_stage='push_ambiguous'), 'NOT_CONFIRMED')
    stranded = with_lifecycle(update('stranded'), 'MERGED', 'STRANDED_UPDATE')
    self.save(sending, not_confirmed, stranded)
    self.assertEqual(stranded['status'], 'merged', 'a stranded update reads as the finished PR, not as prepared')
    self.assertEqual(self.members(record('ok')), (['review:ok'], 'Send'))

  def test_a_stack_with_a_stuck_layer_does_not_join_and_does_not_hold_the_card(self):
    layers = lambda position, **extra: record(f'layer-{position}', plan={'stack': {'id': 's1', 'name': 'Stack', 'position': position, 'total': 2}}, **extra)
    self.save(layers(1), layers(2, last_submit_error='refused'))
    self.assertEqual(self.members(record('ok')), (['review:ok'], 'Send'))

  def test_a_record_the_owner_names_is_still_listed_so_the_card_can_say_why_it_is_held(self):
    held = record('held', needs_attention=True)
    self.assertEqual(self.members(held), (['review:held'], 'Send'))


if __name__ == '__main__':
  unittest.main()
