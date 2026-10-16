"""Fetch a pinned public model; no credentials or remote executable code."""
import hashlib
import json
from pathlib import Path
import requests

model='cross-encoder/ms-marco-MiniLM-L-6-v2'
root=Path(__file__).resolve().parent/'models/ms-marco-MiniLM-L-6-v2'
root.mkdir(parents=True,exist_ok=True)
session=requests.Session()
response=session.get('https://huggingface.co/api/models/'+model,timeout=45)
response.raise_for_status(); info=response.json(); revision=info['sha']
names={x['rfilename'] for x in info['siblings']}
selected=['config.json','tokenizer_config.json','special_tokens_map.json','tokenizer.json','vocab.txt','README.md','model.safetensors']
assert 'model.safetensors' in names, 'Safe weights not available'
files={}
for name in selected:
    if name not in names: continue
    response=session.get(f'https://huggingface.co/{model}/resolve/{revision}/{name}',timeout=180)
    response.raise_for_status()
    data=response.content
    (root/name).write_bytes(data)
    files[name]=dict(bytes=len(data),sha256=hashlib.sha256(data).hexdigest())
    print(name,len(data),flush=True)
(root/'provenance.json').write_text(json.dumps(dict(model=model,revision=revision,files=files),indent=2),encoding='utf-8')
print('Saved:',root,flush=True)
