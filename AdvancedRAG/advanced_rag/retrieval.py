"""Same dense encoder/L2 as baseline; token-bounded views of structural chunks."""
import json
import time
from pathlib import Path
from .chunking import mask_pages

class StructuralRetriever:
    def __init__(self, chunks, cache_dir, enrich=False):
        import faiss
        from sentence_transformers import SentenceTransformer
        started = time.perf_counter()
        self.chunks = chunks
        self.sha256 = chunks[0]['source_sha256']
        self.by_id = {c['id']:c for c in chunks}
        self.embedder = SentenceTransformer('sentence-transformers/all-MiniLM-L6-v2', device='cpu', cache_folder=str(cache_dir), local_files_only=True)
        self.entries = []
        tokenizer = self.embedder.tokenizer
        granular = {'function','modifier','event','error','test_case'}
        selected = [c for c in chunks if c['artifact_type'] in granular]
        represented = {c['artifact_id'] for c in selected}
        selected += [c for c in chunks if c['artifact_type']=='source_artifact' and c['artifact_id'] not in represented]
        for chunk in selected:
            content = mask_pages(chunk['text'])
            prefix = ''
            if enrich:
                prefix = f"[{chunk['artifact_type']} {chunk['name']} | {chunk['source_file']} | family={','.join(chunk['contract_family'])} | behavior={','.join(chunk['tested_behavior'])}]\n"
            available = self.embedder.max_seq_length - len(tokenizer.encode(prefix,add_special_tokens=False)) - 6
            if available < 32:
                prefix = f"[{chunk['artifact_type']}]\n"
                available = self.embedder.max_seq_length - len(tokenizer.encode(prefix,add_special_tokens=False)) - 6
            offsets = tokenizer(content,add_special_tokens=False,return_offsets_mapping=True,truncation=False,verbose=False)['offset_mapping']
            for start in range(0,len(offsets),available):
                part = offsets[start:start+available]
                begin,end = part[0][0],part[-1][1]
                view = content[begin:end]
                embedded = prefix + view
                if len(tokenizer.encode(embedded)) > self.embedder.max_seq_length:
                    raise ValueError('Embedding window exceeds encoder limit')
                self.entries.append(dict(chunk_id=len(self.entries),structural_id=chunk['id'],
                    window_start_char=chunk['start_char']+begin,window_end_char=chunk['start_char']+end,
                    text=embedded,embedding_text=embedded,is_partial_unit=len(offsets)>available))
        vectors = self.embedder.encode([v['embedding_text'] for v in self.entries],batch_size=32,show_progress_bar=False).astype('float32')
        self.index = faiss.IndexFlatL2(vectors.shape[1])
        self.index.add(vectors)
        self.initialization_seconds = time.perf_counter()-started

    def search(self, query, top_k=10, filters=None, max_context_chars=15000):
        started = time.perf_counter()
        if top_k < 1:
            raise ValueError('top_k must be positive')
        filters = filters or {}
        allowed = {'artifact_type','contract_family','tested_behavior','test_type','testing_framework','parser'}
        if set(filters)-allowed:
            raise ValueError('Unknown metadata filter')
        vector = self.embedder.encode([query],show_progress_bar=False).astype('float32')
        distances,indices = self.index.search(vector,len(self.entries))
        hits, used = [], 0
        for distance, index in zip(distances[0],indices[0]):
            entry = self.entries[int(index)]
            chunk = self.by_id[entry['structural_id']]
            if any(value not in (chunk[key] if isinstance(chunk[key],list) else [chunk[key]]) for key,value in filters.items()):
                continue
            if used + len(entry['text']) > max_context_chars:
                continue
            hits.append({**entry,'distance':float(distance),
                'metadata':{k:v for k,v in chunk.items() if k!='text'}})
            used += len(entry['text'])
            if len(hits) >= top_k:
                break
        return hits,time.perf_counter()-started
