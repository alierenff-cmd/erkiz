$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$wb = $excel.Workbooks.Open('C:\Users\ali_e\OneDrive\Documents\T.C PERSONEL DOĞUM TARİHİ.xlsx')
$ws = $wb.Sheets.Item(1)
$range = $ws.UsedRange

for ($r = 1; $r -le $range.Rows.Count; $r++) {
    $row = @()
    for ($c = 1; $c -le $range.Columns.Count; $c++) {
        $row += $range.Cells.Item($r, $c).Text
    }
    Write-Output ($row -join '|')
}

$wb.Close($false)
$excel.Quit()
