import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('pr_block', Path(__file__).parents[1] / 'pr_block.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

BASE = {'number': 7, 'title': 'A change', 'state': 'open', 'base': {'repo': {'full_name': 'owner/repo'}}}


class PullBlockTests(unittest.TestCase):
  def test_static_snapshot_names_exact_identity_without_authority(self):
    calls = []
    def read(path):
      calls.append(path)
      return {**BASE, 'user': {'login': 'octocat'}, 'labels': [{'name': 'bug', 'color': 'd73a4a'}],
        'changed_files': 2, 'additions': 4, 'deletions': 1}
    block = module.pull_block('owner/repo#7', read)
    self.assertEqual(calls, ['repos/owner/repo/pulls/7'])
    self.assertEqual(block['intent'], 'pull-request:owner/repo#7')
    self.assertIs(block['inline'], False)
    self.assertEqual(set(block), {'app', 'intent', 'title', 'inline', 'facts'})
    self.assertEqual(block['facts'][0], {'label': 'Pull request', 'value': 'owner/repo#7', 'href': 'https://github.com/owner/repo/pull/7'})
    self.assertIn({'label': 'Change', 'value': '2 files · +4 −1'}, block['facts'])
    self.assertIn({'label': 'Labels', 'value': 'bug'}, block['facts'])
    self.assertIn({'label': 'Author', 'value': 'octocat'}, block['facts'])

  def test_url_reference_uses_canonical_repository(self):
    block = module.pull_block('https://github.com/Owner/Repo/pull/7', lambda _: BASE)
    self.assertEqual(block['intent'], 'pull-request:owner/repo#7')

  def test_invalid_identity_never_reads(self):
    for reference in ('../repo#7', 'owner/..#7', 'owner/repo#0', 'owner/repo', 'owner/repo#7 extra'):
      with self.assertRaises(ValueError):
        module.pull_block(reference, lambda _: self.fail('read'))

  def test_moved_pr_is_refused(self):
    with self.assertRaises(ValueError):
      module.pull_block('owner/repo#7', lambda _: {**BASE, 'base': {'repo': {'full_name': 'other/repo'}}})

  def test_states_match_github(self):
    state = lambda extra: next(f['value'] for f in module.pull_block('owner/repo#7', lambda _: {**BASE, **extra})['facts'] if f['label'] == 'State')
    self.assertEqual(state({'draft': True}), 'Draft')
    self.assertEqual(state({'state': 'closed', 'merged': True}), 'Merged')
    self.assertEqual(state({'state': 'closed'}), 'Closed')
    self.assertEqual(state({}), 'Open')

  def test_long_text_fits_the_block_bounds(self):
    block = module.pull_block('owner/repo#7', lambda _: {**BASE, 'title': 'x' * 256,
      'labels': [{'name': f'label-{n}'} for n in range(60)]})
    self.assertLessEqual(len(block['title']), 240)
    self.assertTrue(block['title'].endswith('…'))
    self.assertTrue(all(len(fact['value']) <= 240 for fact in block['facts']))

  def test_titles_are_bounded_in_utf16_units_like_the_renderer(self):
    block = module.pull_block('owner/repo#7', lambda _: {**BASE, 'title': '\U0001F680' * 250})
    self.assertLessEqual(module.utf16_length(block['title']), 240)
    self.assertTrue(block['title'].endswith('…'))
    self.assertEqual(module.bounded('\U0001F680' * 120), '\U0001F680' * 120, 'exactly 240 units fits unchanged')

  def test_unreadable_pr_is_one_line_not_a_traceback(self):
    import subprocess, io, contextlib
    from unittest import mock
    failure = subprocess.CalledProcessError(1, ['gh'], stderr='gh: Not Found (HTTP 404)\n')
    stderr = io.StringIO()
    with mock.patch.object(module, 'gh_read', side_effect=failure), mock.patch('sys.argv', ['pr_block.py', 'owner/repo#7']), \
         contextlib.redirect_stderr(stderr), self.assertRaises(SystemExit) as raised:
      module.main()
    self.assertIn('could not read that pull request (gh: Not Found (HTTP 404))', str(raised.exception.code))
    self.assertNotIn('Traceback', stderr.getvalue())
    with mock.patch('sys.argv', ['pr_block.py', 'not a pr']), self.assertRaises(SystemExit) as invalid:
      module.main()
    self.assertIn('Use owner/repository#123', str(invalid.exception.code))

  def test_one_changed_file_is_readable(self):
    block = module.pull_block('owner/repo#7', lambda _: {**BASE, 'changed_files': 1})
    self.assertIn({'label': 'Change', 'value': '1 file · +0 −0'}, block['facts'])


if __name__ == '__main__':
  unittest.main()
