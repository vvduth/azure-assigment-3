import { app, HttpRequest, HttpResponseInit, InvocationContext, Timer } from "@azure/functions";
import { BlobServiceClient, ContainerClient, BlobItem } from "@azure/storage-blob";
import { checkConcurrentExecution, createProcessingLock, removeProcessingLock } from "../utils/lockUtils";
import { REPORTS_CONTAINER, STORAGE_CONNECTION_STRING } from "../utils/constants";
import { cleanupProcessedFiles, generateProcessingStats, initializeContainers, listReportFiles, logProcessingResults, processReportsWithRetry } from "../utils/reportUtils";

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
  let blobServiceClient;
  let lockCreated = false; // Track whether we successfully created a lock
  try {
    // Initialize blob service client
    blobServiceClient = BlobServiceClient.fromConnectionString(STORAGE_CONNECTION_STRING);
    
    // Check for concurrent execution lock
    if (await checkConcurrentExecution(blobServiceClient, lockKey, context)) {
      context.log('Another instance is already running. Exiting.');
      return;
    }    // Create processing lock
    await createProcessingLock(blobServiceClient, lockKey, context);
    lockCreated = true; // Mark that we successfully created the lock

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
    context.error('Critical error in daily report processor', error);
    throw error;  } finally {
    // Always remove processing lock, even if processing failed
    // Only attempt cleanup if blobServiceClient was successfully initialized AND we created a lock
    if (blobServiceClient && lockCreated) {
      try {
        await removeProcessingLock(blobServiceClient, lockKey, context);
      } catch (lockError) {
        // Log the error but don't throw it - lock removal failure shouldn't fail the main process
        context.error('Error removing processing lock', lockError);
      }
    }
  }
}

// TEMPORARY: For testing - runs every minute
app.timer('dailyReportProcessor', {
  schedule: '0 * * * * *', // Every minute at 0 seconds
  handler: dailyReportProcessor
});