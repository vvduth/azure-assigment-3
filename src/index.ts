import { app } from '@azure/functions';
import { dailyReportProcessor } from './functions/dailyReportProcessor';

app.setup({
    enableHttpStream: true,
});