# Advanced v3 (function-decomposed retrieval), defined 2026-10-01 before any held-out generation. Resumable.
$py="..\RAGUnitTest4SC-\.venv\Scripts\python.exe"
$manifest="..\RAGUnitTest4SC-\data\benchmarks\enase30\manifest.json"
$hh="..\RAGUnitTest4SC-\src\main\resources\HardhatProject-ethers6"
foreach($rep in "rep01","rep02","rep03"){ "=== development14 advanced-v3 $rep $(Get-Date -Format s)"; & $py run_generation_ethers6.py --manifest $manifest --split development-original14 --input-dir outputs\development14-advanced-v3-ethers6-v1 --hardhat-dir $hh --run "development14-advanced-v3-ethers6-v1-$rep"; if($LASTEXITCODE -ne 0){ "STOPPED"; exit 1 } }
if(-not (Test-Path outputs\heldout16-advanced-v3-ethers6-v1\summary.json)){ "=== heldout16 prompts $(Get-Date -Format s)"; & $py prepare_corpus_v2_prompts.py --config advanced-v3 --split heldout16 }
foreach($rep in "rep01","rep02","rep03"){ "=== heldout16 advanced-v3 $rep $(Get-Date -Format s)"; & $py run_generation_ethers6.py --manifest $manifest --split heldout-new16 --input-dir outputs\heldout16-advanced-v3-ethers6-v1 --hardhat-dir $hh --run "heldout16-advanced-v3-ethers6-v1-$rep"; if($LASTEXITCODE -ne 0){ "STOPPED"; exit 1 } }
"=== done $(Get-Date -Format s)"
& $py analyze_corpus_v2_campaign.py
