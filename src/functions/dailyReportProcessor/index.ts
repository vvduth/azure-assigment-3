import { app, Timer, InvocationContext } from "@azure/functions";
import { BlobServiceClient } from "@azure/storage-blob";
import { checkConcurrentExecution, createProcessingLock, removeProcessingLock } from "../../utils/lockUtils";
import {
  initializeContainers,
  listReportFiles,
  processReportsWithRetry,
  generateProcessingStats,
  cleanupProcessedFiles,
  logProcessingResults
} from "../../utils/reportUtils";

const STORAGE_CONNECTION_STRING = process.env.AzureWebJobsStorage || "";

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

  // Create unique lock key for today's processing
  const lockKey = `daily-report-processor-lock-${new Date().toISOString().split('T')[0]}`;
  
  try {
    // Initialize blob service client  
    const blobServiceClient = BlobServiceClient.fromConnectionString(STORAGE_CONNECTION_STRING);
    
    // Check for concurrent execution lock
    if (await checkConcurrentExecution(blobServiceClient, lockKey, context)) {
      context.log('Another instance is already running. Exiting.');
      return;
    }

    // Create processing lock to prevent concurrent executions
    await createProcessingLock(blobServiceClient, lockKey, context);

    // Initialize all required containers
    await initializeContainers(blobServiceClient, context);

    // Get list of reports to process
    const reportsContainer = blobServiceClient.getContainerClient('daily-reports');
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
    
    // Log final results with detailed statistics
    logProcessingResults(stats, context);

    // Cleanup processed files and handle errors
    await cleanupProcessedFiles(blobServiceClient, results, context);

  } catch (error) {
    context.error('Critical error in daily report processor', error);
    throw error;
  } finally {
    // Always remove processing lock, even if processing failed
    try {
      const blobServiceClient = BlobServiceClient.fromConnectionString(STORAGE_CONNECTION_STRING);
      await removeProcessingLock(blobServiceClient, lockKey, context);
    } catch (lockError) {
      context.error('Error removing processing lock', lockError);
    }
  }
}

// Register the timer trigger function
// Runs daily at 2:00 AM UTC (cron expression: 0 0 2 * * *)
app.timer('dailyReportProcessor', {
  schedule: '0 0 2 * * *', // Daily at 2 AM UTC
  handler: dailyReportProcessor
});
