import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from "@azure/functions";
import { BlobServiceClient, ContainerClient, BlobItem } from "@azure/storage-blob";
import { checkConcurrentExecution } from "../../utils/checkConcurrentExecution";

const STORAGE_CONNECTION_STRING = process.env.AzureWebJobsStorage || "";
const REPORTS_CONTAINER = "daily-reports";
const PROCESSED_CONTAINER = "processed-reports";
const ERROR_CONTAINER = "error-reports";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

// Interface for report processing result
interface ProcessingResult {
  fileName: string;
  success: boolean;
  error?: string;
  retryCount?: number;
}

// Interface for report data structure
interface ReportData {
  date: string;
  records: any[];
  metadata: {
    totalRecords: number;
    processedAt: string;
    source: string;
  };
}

// Interface for processing statistics
interface ProcessingStats {
  totalFiles: number;
  successfulFiles: number;
  failedFiles: number;
  retryCount: number;
  processingTime: number;
}

/**
 * Main daily report processor function
 * Triggers daily at 2AM UTC to process accumulated reports
 * Implements retry logic, error handling, and proper cleanup
 */

export async function dailyReportProcessor(
  myTimer: Timer,
  context: InvocationContext
): Promise<void> {
  const startTime = Date.now();
  
  // Log function start with timer info
  context.log('Daily report processor started', {
    scheduleStatus: myTimer.scheduleStatus,
    isPastDue: myTimer.isPastDue,
    timestamp: new Date().toISOString()
  });

  // Prevent concurrent executions by checking if another instance is running
  const lockKey = `daily-report-processor-lock-${new Date().toISOString().split('T')[0]}`;
  
  try {
    // Initialize blob service client
    const blobServiceClient = BlobServiceClient.fromConnectionString(STORAGE_CONNECTION_STRING);
    
    // Check for concurrent execution lock
    if (await checkConcurrentExecution(blobServiceClient, lockKey, context)) {
      context.log('Another instance is already running. Exiting.');
      return;
    }

    // Create processing lock
    await createProcessingLock(blobServiceClient, lockKey, context);

    // Initialize containers
    await initializeContainers(blobServiceClient, context);

    // Get list of reports to process
    const reportsContainer = blobServiceClient.getContainerClient(REPORTS_CONTAINER);
    const reportFiles = await listReportFiles(reportsContainer, context);

    if (reportFiles.length === 0) {
      context.log('No reports found to process');
      return;
    }

    context.log(`Found ${reportFiles.length} reports to process`);

    // Process reports with retry logic
    const results = await processReportsWithRetry(
      blobServiceClient,
      reportFiles,
      context
    );

    // Generate processing statistics
    const stats = generateProcessingStats(results, startTime);
    
    // Log final results
    logProcessingResults(stats, context);

    // Cleanup processed files
    await cleanupProcessedFiles(blobServiceClient, results, context);

  } catch (error) {
    context.log.error('Critical error in daily report processor', error);
    throw error;
  } finally {
    // Always remove processing lock
    await removeProcessingLock(blobServiceClient, lockKey, context);
  }
}