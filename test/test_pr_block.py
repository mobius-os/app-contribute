import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('pr_block', Path(__file__).parents[1] / 'pr_block.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PullBlockTests(unittest.TestCase):
  def test_snapshot_is_read_only_and_names_exact_identity(self):
    calls=[]
    def read(path):
      calls.append(path)
      return {'number':7,'title':'A change','state':'open','base':{'repo':{'full_name':'owner/repo'}},'head':{'sha':'a'*40},'user':{'login':'octocat'},'labels':[{'name':'bug','color':'d73a4a'}],'changed_files':2,'additions':4,'deletions':1}
    block=module.pull_block('owner/repo#7',read)
    self.assertEqual(calls,['repos/owner/repo/pulls/7'])
    self.assertEqual(block['intent'],'pull-request:owner/repo#7')
    self.assertIs(block['inline'],False)
    self.assertNotIn('approved',block)
    self.assertEqual(block['title'],'A change')
    self.assertEqual(block['pull'],{'repo':'owner/repo','number':7,'state':'open','author':'octocat','files':2,'additions':4,'deletions':1,
      'labels':[{'name':'bug','color':'d73a4a'}],'url':'https://github.com/owner/repo/pull/7'})
    self.assertIn({'label':'Change','value':'2 files · +4 −1'},block['facts'])
    self.assertIn({'label':'Labels','value':'bug'},block['facts'])
    self.assertFalse(any(fact['label'] == 'Version' for fact in block['facts']))
  def test_invalid_identity_never_reads(self):
    with self.assertRaises(ValueError): module.pull_block('../repo#7',lambda _:self.fail('read'))

  def test_draft_and_merged_states_match_github(self):
    base={'number':7,'title':'A change','base':{'repo':{'full_name':'owner/repo'}},'head':{'sha':'a'*40}}
    self.assertEqual(module.pull_block('owner/repo#7',lambda _: {**base,'state':'open','draft':True})['pull']['state'],'draft')
    self.assertEqual(module.pull_block('owner/repo#7',lambda _: {**base,'state':'closed','merged':True})['pull']['state'],'merged')
    self.assertEqual(module.pull_block('owner/repo#7',lambda _: {**base,'state':'closed'})['pull']['state'],'closed')

  def test_one_changed_file_is_readable(self):
    block=module.pull_block('owner/repo#7',lambda _: {'number':7,'title':'A change','state':'open','base':{'repo':{'full_name':'owner/repo'}},'head':{'sha':'a'*40},'changed_files':1})
    self.assertIn({'label':'Change','value':'1 file · +0 −0'},block['facts'])
