import unittest
import numpy as np
from advanced_rag.retrieval import StructuralRetriever

class FakeEncoder:
    def encode(self,*args,**kwargs):
        return np.zeros((1,2))

class FakeIndex:
    def search(self,vector,count):
        return np.array([[0.1,0.2,0.3]]),np.array([[0,1,2]])

class RetrievalTests(unittest.TestCase):
    def setUp(self):
        self.r = StructuralRetriever.__new__(StructuralRetriever)
        self.r.embedder = FakeEncoder()
        self.r.index = FakeIndex()
        self.r.entries = [dict(chunk_id=i,structural_id=str(i),text='text'+str(i)) for i in range(3)]
        self.r.by_id = {str(i):dict(artifact_type='function' if i==0 else 'test_case',
                                   contract_family=['ERC20'],parser='strict_ast') for i in range(3)}

    def test_filter_searches_beyond_first_rank_and_respects_budget(self):
        hits,_ = self.r.search('query',top_k=2,filters={'artifact_type':'test_case','contract_family':'ERC20'},max_context_chars=5)
        self.assertEqual([h['chunk_id'] for h in hits],[1])

    def test_unknown_filter_rejected(self):
        with self.assertRaises(ValueError):
            self.r.search('query',filters={'made_up':'value'})

    def test_no_matching_label_returns_no_hits(self):
        hits,_ = self.r.search('query',filters={'contract_family':'ERC721'})
        self.assertEqual(hits,[])

if __name__=='__main__':
    unittest.main()
