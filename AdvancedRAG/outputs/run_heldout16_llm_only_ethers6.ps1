$py='..\RAGUnitTest4SC-\.venv\Scripts\python.exe'
foreach($rep in 'rep01','rep02','rep03'){
  "=== heldout16 llm-only ethers6 $rep $(Get-Date -Format s)"
  & $py run_generation_ethers6.py --manifest ..\RAGUnitTest4SC-\data\benchmarks\enase30\manifest.json --split heldout-new16 --input-dir "outputs\heldout16-llm-only-ethers6-v1" --hardhat-dir ..\RAGUnitTest4SC-\src\main\resources\HardhatProject-ethers6 --run "heldout16-llm-only-ethers6-v1-$rep"
}
"=== done $(Get-Date -Format s)"
