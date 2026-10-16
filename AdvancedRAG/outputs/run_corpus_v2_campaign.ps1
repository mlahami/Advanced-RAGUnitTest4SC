# Corpus v2 campaign: RAG v2 and Advanced v2, ethers 6, 30 contracts x 3 repetitions.
# Resumable: rerun the same script; completed generations are reused, finished runs are skipped quickly.
# LLM-only ethers 6: development14 runs already exist; heldout16 runs come from run_heldout16_llm_only_ethers6.ps1.
# Run from the AdvancedRAG folder:  powershell -ExecutionPolicy Bypass -File outputs\run_corpus_v2_campaign.ps1
$py='..\RAGUnitTest4SC-\.venv\Scripts\python.exe'
$manifest='..\RAGUnitTest4SC-\data\benchmarks\enase30\manifest.json'
$hh='..\RAGUnitTest4SC-\src\main\resources\HardhatProject-ethers6'
$splits=@{ 'development14'='development-original14'; 'heldout16'='heldout-new16' }
$jobs=@()
foreach($rep in 'rep01','rep02','rep03'){ foreach($cfg in 'rag-v2','advanced-v2'){ foreach($s in 'development14','heldout16'){
  $jobs += ,@($s, $splits[$s], "outputs\$s-$cfg-ethers6-v1", "$s-$cfg-ethers6-v1-$rep") } } }
"=== preflight $(Get-Date -Format s)"
foreach($j in $jobs){
  & $py run_generation_ethers6.py --manifest $manifest --split $j[1] --input-dir $j[2] --hardhat-dir $hh --run $j[3] --preflight | Out-Null
  if($LASTEXITCODE -ne 0){ "PREFLIGHT FAILED $($j[3])"; exit 1 }
}
foreach($j in $jobs){
  "=== $($j[3]) $(Get-Date -Format s)"
  & $py run_generation_ethers6.py --manifest $manifest --split $j[1] --input-dir $j[2] --hardhat-dir $hh --run $j[3]
  if($LASTEXITCODE -ne 0){ "RUN STOPPED $($j[3]) (exit $LASTEXITCODE); rerun this script to resume"; exit 1 }
}
"=== done $(Get-Date -Format s)"
& $py analyze_corpus_v2_campaign.py
