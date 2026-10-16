param([string]$Candidates, [string]$Log)
$py = '..\RAGUnitTest4SC-\.venv\Scripts\python.exe'
& $py corpus_v2\import_pair.py $Candidates
$pairs = (Get-Content data\corpus-v2\import_log.json -Raw | ConvertFrom-Json) | Where-Object { $_.pair } | ForEach-Object { "data\corpus-v2\pairs\" + $_.pair }
Copy-Item data\corpus-v2\import_log.json ($Log -replace '\.log$', '.import.json')
& $py corpus_v2\validate_pair.py @pairs
"=== done $(Get-Date -Format s)"
