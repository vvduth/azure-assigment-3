export const STORAGE_CONNECTION_STRING = process.env.AzureWebJobsStorage || "";
export const REPORTS_CONTAINER = "daily-reports";
export const PROCESSED_CONTAINER = "processed-reports";
export const ERROR_CONTAINER = "error-reports";
export const MAX_RETRIES = 3;
export const RETRY_DELAY_MS = 1000;