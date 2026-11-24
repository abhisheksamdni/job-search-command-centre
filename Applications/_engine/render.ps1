# Renders a tailored CV and cover letter by editing a copy of the master DOCX in Word,
# so every font, tab stop, bullet and spacing rule of the original CV is preserved.
#
#   render.ps1 -Map                         write master\paragraph-map.txt (indexes for specs)
#   render.ps1 -Spec <spec.json> -OutDir <folder>
#
# Prints one JSON line on stdout: {ok, cv:{docx,pdf,pages,text}, letter:{docx,pdf,pages,text}, error}
param(
  [string]$Spec,
  [string]$OutDir,
  [switch]$Map
)
$ErrorActionPreference = 'Stop'
$master = Join-Path $PSScriptRoot 'master\Master CV.docx'

function Clean([string]$s) {
  if ($null -eq $s) { return '' }
  ($s -replace "[\r\a\x07]", '' -replace "\u000B", '').Trim()
}
function Key([string]$s) {
  # Comparable prefix of a paragraph: no bullets, tabs, extra spaces or case.
  ((Clean $s) -replace '^[^\p{L}\p{N}]+', '' -replace '\s+', ' ').Trim().ToLowerInvariant()
}
$script:name = 'Candidate'
function Set-DocProps($doc, [string]$title) {
  try { $doc.RemoveDocumentInformation(99) } catch {}
  foreach ($pair in @(@('Author', $script:name), @('Title', $title), @('Last Author', $script:name))) {
    try {
      $props = $doc.BuiltInDocumentProperties
      $prop = [System.__ComObject].InvokeMember('Item', [Reflection.BindingFlags]::GetProperty, $null, $props, @($pair[0]))
      [System.__ComObject].InvokeMember('Value', [Reflection.BindingFlags]::SetProperty, $null, $prop, @($pair[1])) | Out-Null
    } catch {}
  }
}
function Export($doc, [string]$docx, [string]$pdf) {
  $doc.SaveAs2($docx, 16)
  # 17 = PDF; DocStructureTags=true keeps a tagged, machine-readable reading order for ATS parsers.
  $doc.ExportAsFixedFormat($pdf, 17, $false, 0, 0, 1, 1, 0, $true, $true, 0, $true, $true, $false)
  @{ docx = $docx; pdf = $pdf; pages = $doc.ComputeStatistics(2); text = ($doc.Content.Text -replace "`r", "`n") }
}

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$result = @{ ok = $false }
try {
  if ($Map) {
    $doc = $word.Documents.Open($master, $false, $true)
    $lines = @(); $i = 0
    foreach ($p in $doc.Paragraphs) {
      $i++
      $kind = if ($p.Range.ListFormat.ListType -ne 0) { 'BULLET' } elseif ((Clean $p.Range.Text) -eq '') { 'BLANK' } else { 'TEXT' }
      $lines += ('{0,3} {1,-6} {2}' -f $i, $kind, ((Clean $p.Range.Text) -replace "`t", ' <TAB> '))
    }
    $doc.Close($false)
    $out = Join-Path $PSScriptRoot 'master\paragraph-map.txt'
    $lines | Set-Content -Path $out -Encoding utf8
    $result = @{ ok = $true; map = $out; paragraphs = $i }
  }
  else {
    $s = Get-Content $Spec -Raw -Encoding utf8 | ConvertFrom-Json
    if ($s.candidateName) { $script:name = [string]$s.candidateName }
    New-Item -ItemType Directory -Force $OutDir | Out-Null
    $stem = $s.fileStem

    # ---------- CV ----------
    $doc = $word.Documents.Open($master, $false, $true)
    $paras = @($null); foreach ($p in $doc.Paragraphs) { $paras += $p }
    $ops = @($s.cv.ops)

    # Validate every anchor first: if the master CV changed, nothing is applied.
    foreach ($op in $ops) {
      $ids = @($op.p); $exp = @($op.expect)
      for ($k = 0; $k -lt $ids.Count; $k++) {
        $id = [int]$ids[$k]
        if ($id -lt 1 -or $id -ge $paras.Count) { throw "Paragraph $id does not exist in the master CV" }
        $want = if ($exp.Count -gt $k) { Key $exp[$k] } else { $null }
        if ($null -ne $want) {
          $have = Key $paras[$id].Range.Text
          if (-not $have.StartsWith($want)) { throw "Anchor mismatch at paragraph ${id}: expected '$want', found '$($have.Substring(0,[Math]::Min(60,$have.Length)))'" }
        }
      }
    }

    $lastInsert = @{}
    foreach ($op in $ops) {
      switch ($op.op) {
        'replace' {
          $r = $paras[[int]$op.p].Range; $r.MoveEnd(1, -1) | Out-Null; $r.Text = $op.text
        }
        'replaceAfter' {
          # Keep the bold label (e.g. "Technical Skills:") and replace what follows the separator.
          $r = $paras[[int]$op.p].Range; $r.MoveEnd(1, -1) | Out-Null
          $at = $r.Text.IndexOf([string]$op.sep)
          if ($at -lt 0) { throw "Separator '$($op.sep)' not found in paragraph $($op.p)" }
          $tail = $doc.Range($r.Start + $at + ([string]$op.sep).Length, $r.End)
          # Keep the master's spacing after the label (e.g. "Skills: ").
          $lead = if ($op.sep -eq ':') { ' ' } else { '' }
          $tail.Text = $lead + ([string]$op.text).TrimStart()
          $tail.Font.Bold = 0
        }
        'insertAfter' {
          $anchorId = [int]$op.p
          $anchor = if ($lastInsert.ContainsKey($anchorId)) { $lastInsert[$anchorId] } else { $paras[$anchorId] }
          $anchor.Range.InsertParagraphAfter()
          $new = $anchor.Next(1)
          $r = $new.Range; $r.MoveEnd(1, -1) | Out-Null; $r.Text = $op.text
          $lastInsert[$anchorId] = $new
        }
      }
    }
    # Deletes run before moves: a move re-creates its paragraphs, which would orphan later deletes.
    # A move's first and last paragraph therefore must not be deleted.
    $toDelete = @(); foreach ($op in $ops | Where-Object { $_.op -eq 'delete' }) { $toDelete += @($op.p) | ForEach-Object { [int]$_ } }
    foreach ($op in $ops | Where-Object { $_.op -eq 'moveBefore' }) {
      $ids = @($op.p) | ForEach-Object { [int]$_ }
      foreach ($edge in @(($ids | Measure-Object -Minimum).Minimum, ($ids | Measure-Object -Maximum).Maximum, [int]$op.before)) {
        if ($toDelete -contains $edge) { throw "Paragraph $edge bounds a move and cannot also be deleted" }
      }
    }
    foreach ($id in ($toDelete | Sort-Object -Descending -Unique)) { $paras[$id].Range.Delete() | Out-Null }
    foreach ($op in $ops | Where-Object { $_.op -eq 'moveBefore' }) {
      $ids = @($op.p) | ForEach-Object { [int]$_ }
      $src = $doc.Range($paras[($ids | Measure-Object -Minimum).Minimum].Range.Start, $paras[($ids | Measure-Object -Maximum).Maximum].Range.End)
      $dst = $paras[[int]$op.before].Range
      $doc.Range($dst.Start, $dst.Start).FormattedText = $src.FormattedText
      $src.Delete() | Out-Null
    }

    Set-DocProps $doc "$script:name CV"
    $result.cv = Export $doc (Join-Path $OutDir "$stem.docx") (Join-Path $OutDir "$stem.pdf")
    $doc.Close($false)

    # ---------- Cover letter: same header as the CV, then the letter ----------
    if ($s.coverLetter) {
      $cl = $s.coverLetter
      $doc = $word.Documents.Open($master, $false, $true)
      $count = $doc.Paragraphs.Count
      $doc.Range($doc.Paragraphs(3).Range.Start, $doc.Paragraphs($count).Range.End).Delete() | Out-Null
      $body = @()
      $body += , @($cl.date, 'left', 12)
      foreach ($line in @($cl.recipient)) { $body += , @($line, 'left', 0) }
      $body += , @('', 'left', 0)
      if ($cl.subject) { $body += , @($cl.subject, 'bold', 10) }
      $body += , @($cl.greeting, 'left', 8)
      foreach ($para in @($cl.paragraphs)) { $body += , @($para, 'justify', 8) }
      $body += , @($cl.signoff, 'left', 4)
      $body += , @($script:name, 'left', 0)
      foreach ($item in $body) {
        $doc.Content.InsertParagraphAfter()
        $p = $doc.Paragraphs($doc.Paragraphs.Count)
        $r = $p.Range; $r.MoveEnd(1, -1) | Out-Null; $r.Text = [string]$item[0]
        $p.Range.ListFormat.RemoveNumbers()
        $p.Range.Font.Name = 'Times New Roman'; $p.Range.Font.Size = 11
        $p.Range.Font.Bold = [int]($item[1] -eq 'bold')
        $p.Alignment = if ($item[1] -eq 'justify') { 3 } else { 0 }
        $p.LeftIndent = 0; $p.FirstLineIndent = 0
        $p.SpaceBefore = 0; $p.SpaceAfter = [int]$item[2]; $p.LineSpacingRule = 0
        $p.Borders.Enable = 0
      }
      # The CV header's rule sits under the contact line; give the letter breathing room.
      $doc.Paragraphs(2).SpaceAfter = 14
      Set-DocProps $doc "$script:name Cover Letter"
      $result.letter = Export $doc (Join-Path $OutDir "$($s.letterStem).docx") (Join-Path $OutDir "$($s.letterStem).pdf")
      $doc.Close($false)
    }
    $result.ok = $true
  }
}
catch {
  $result.error = $_.Exception.Message
  try { foreach ($d in @($word.Documents)) { $d.Close($false) } } catch {}
}
finally {
  $word.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) | Out-Null
}
$result | ConvertTo-Json -Depth 6 -Compress
