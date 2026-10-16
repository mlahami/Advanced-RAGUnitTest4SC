"""BM25 + squared-L2 candidate retrieval, RRF, optional local cross-encoder."""
from collections import Counter
import math
import re
import time
from pathlib import Path

def code_tokens(text):
    tokens=[]
    for word in re.findall(r'[A-Za-z_$][\w$]*|0x[0-9a-fA-F]+|\d+',text):
        tokens.append(word.lower())
        parts=re.sub(r'([a-z0-9])([A-Z])',r'\1 \2',word).replace('_',' ').split()
        tokens.extend(p.lower() for p in parts if p.lower()!=word.lower())
    return tokens

class BM25:
    def __init__(self, documents, k1=1.5, b=0.75):
        self.k1,self.b=k1,b
        self.tf=[Counter(code_tokens(d)) for d in documents]
        self.lengths=[sum(t.values()) for t in self.tf]
        self.avg=sum(self.lengths)/max(1,len(self.lengths)) or 1
        df=Counter(t for doc in self.tf for t in doc)
        self.idf={t:math.log(1+(len(documents)-n+0.5)/(n+0.5)) for t,n in df.items()}

    def scores(self,query):
        terms=set(code_tokens(query))
        return [sum(self.idf.get(t,0)*doc[t]*(self.k1+1)/
                    (doc[t]+self.k1*(1-self.b+self.b*length/self.avg))
                    for t in terms if doc[t]) for doc,length in zip(self.tf,self.lengths)]

def rrf(rankings, constant=60):
    if constant<=0: raise ValueError('RRF constant must be positive')
    scores={}
    for ranking in rankings:
        for rank,key in enumerate(dict.fromkeys(ranking),1):
            scores[key]=scores.get(key,0)+1/(constant+rank)
    return sorted(scores,key=lambda k:(-scores[k],k)),scores

class LocalCrossEncoder:
    def __init__(self, model_path):
        from sentence_transformers import CrossEncoder
        import torch
        torch.set_num_threads(4)
        path=Path(model_path).resolve()
        if not path.is_dir(): raise ValueError('Provide an existing local cross-encoder model directory')
        self.model=CrossEncoder(str(path),device='cpu',max_length=512,local_files_only=True,trust_remote_code=False)

    def score(self,query,documents):
        return self.model.predict([(query,d) for d in documents],batch_size=8,show_progress_bar=False).reshape(-1).tolist()

class HybridRetriever:
    def __init__(self,dense,candidates=50,constant=60,reranker=None):
        if candidates<1 or constant<=0: raise ValueError('Invalid retrieval configuration')
        self.dense=dense
        self.chunks=dense.chunks
        self.initialization_seconds=dense.initialization_seconds
        self.entries=dense.entries
        self.sha256=dense.sha256
        self.sparse=BM25([e['embedding_text'] for e in self.entries])
        self.candidates=candidates
        self.constant=constant
        self.reranker=reranker
        self.last_trace={}

    def search(self,query,top_k=10,filters=None,max_context_chars=15000):
        started=time.perf_counter()
        if top_k<1 or max_context_chars<0: raise ValueError('Invalid selection budget')
        # Dense method validates filters; no context budget during candidate collection.
        dense_hits,_=self.dense.search(query,top_k=max(top_k,self.candidates),filters=filters,max_context_chars=10**12)
        dense_ids=[h['chunk_id'] for h in dense_hits]
        distances={h['chunk_id']:h['distance'] for h in dense_hits}
        scores=self.sparse.scores(query)
        eligible=[]
        for e in self.entries:
            c=self.dense.by_id[e['structural_id']]
            if all(v in (c[k] if isinstance(c[k],list) else [c[k]]) for k,v in (filters or {}).items()): eligible.append(e['chunk_id'])
        sparse_ids=sorted((i for i in eligible if scores[i]>0),key=lambda i:(-scores[i],i))[:max(top_k,self.candidates)]
        ranking,fused=rrf([dense_ids,sparse_ids],self.constant)
        fusion_ranking=list(ranking)
        rerank_started=time.perf_counter()
        ce={}
        if self.reranker and ranking:
            values=self.reranker.score(query,[self.entries[i]['text'] for i in ranking])
            if len(values)!=len(ranking) or not all(math.isfinite(v) for v in values): raise ValueError('Invalid reranker scores')
            ce=dict(zip(ranking,values))
            ranking.sort(key=lambda i:(-ce[i],-fused[i],i))
        rerank_seconds=time.perf_counter()-rerank_started if self.reranker else 0
        hits=[]; used=0
        for i in ranking:
            entry=self.entries[i]
            if used+len(entry['text'])>max_context_chars: continue
            chunk=self.dense.by_id[entry['structural_id']]
            hits.append({**entry,'distance':distances.get(i),'bm25_score':scores[i],
                'rrf_score':fused[i],'cross_encoder_score':ce.get(i),
                'metadata':{k:v for k,v in chunk.items() if k!='text'}})
            used+=len(entry['text'])
            if len(hits)>=top_k: break
        self.last_trace=dict(dense_ranking=dense_ids,sparse_ranking=sparse_ids,fused_scores=fused,
            fusion_ranking=fusion_ranking,final_ranking=ranking,cross_encoder_scores=ce,rerank_seconds=rerank_seconds,
            reranked=bool(self.reranker),selected=[h['chunk_id'] for h in hits],context_chars=used)
        return hits,time.perf_counter()-started
