import { Button } from '@mui/material';
import type { Result } from '../../shared/model.js';
import { resultCsvFilename, resultToCsv } from '../../shared/resultCsv.js';

export function ResultCsvButton({ result }: { result: Result }) {
  return <Button variant="outlined" onClick={() => {
    const blob = new Blob([resultToCsv(result)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = resultCsvFilename(result);
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }}>結果CSVをダウンロード</Button>;
}
