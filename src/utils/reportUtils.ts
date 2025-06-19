import { BlobItem, BlobServiceClient, ContainerClient } from "@azure/storage-blob";
import { ERROR_CONTAINER, MAX_RETRIES, PROCESSED_CONTAINER, REPORTS_CONTAINER, RETRY_DELAY_MS } from "./constants";
import { InvocationContext } from "@azure/functions";
import { ProcessingResult, ProcessingStats, ReportData } from "./types";

/**
 * Initializes all required blob storage containers
 */
export async function initializeContainers(
  blobServiceClient: BlobServiceClient,
  context: InvocationContext
): Promise<void> {
  try {
    const containers = [REPORTS_CONTAINER, PROCESSED_CONTAINER, ERROR_CONTAINER, 'processor-locks'];
    
    for (const containerName of containers) {
      const container = blobServiceClient.getContainerClient(containerName);
      await container.createIfNotExists();
      context.log(`Container '${containerName}' initialized`);
    }
  } catch (error) {
    context.error('Error initializing containers', error);
    throw error;
  }
}

/**
 * Lists all report files in the reports container
 */
export async function listReportFiles(
  reportsContainer: ContainerClient,
  context: InvocationContext
): Promise<BlobItem[]> {
  try {
    const reportFiles: BlobItem[] = [];
    
    for await (const blob of reportsContainer.listBlobsFlat()) {
      // Only process JSON files
      if (blob.name.endsWith('.json')) {
        reportFiles.push(blob);
      }
    }
    
    return reportFiles;
  } catch (error) {
    context.error('Error listing report files', error);
    throw error;
  }
}

/**
 * Processes reports with retry logic
 */
export async function processReportsWithRetry(
  blobServiceClient: BlobServiceClient,
  reportFiles: BlobItem[],
  context: InvocationContext
): Promise<ProcessingResult[]> {
  const results: ProcessingResult[] = [];
  
  // Process files in batches to avoid overwhelming the system
  const batchSize = 10;
  for (let i = 0; i < reportFiles.length; i += batchSize) {
    const batch = reportFiles.slice(i, i + batchSize);
    
    const batchPromises = batch.map(async (file) => {
      return await processReportWithRetry(blobServiceClient, file.name, context);
    });
    
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    // Small delay between batches
    if (i + batchSize < reportFiles.length) {
      await sleep(100);
    }
  }
  
  return results;
}

/**
 * Processes a single report file
 */
export async function processReport(
  blobServiceClient: BlobServiceClient,
  fileName: string,
  context: InvocationContext
): Promise<void> {
  const reportsContainer = blobServiceClient.getContainerClient(REPORTS_CONTAINER);
  const reportBlob = reportsContainer.getBlobClient(fileName);
  
  // Download and parse report data
  const downloadResponse = await reportBlob.download();
  const reportContent = await streamToString(downloadResponse.readableStreamBody!);
  
  // Validate JSON format
  let reportData: ReportData;
  try {
    reportData = JSON.parse(reportContent);
  } catch (parseError) {
    throw new Error(`Invalid JSON format in ${fileName}: ${parseError}`);
  }
  
  // Validate report structure
  validateReportData(reportData, fileName);
  
  // Process the report data (simulate processing)
  const processedData = await processReportData(reportData, context);
  
  // Move processed report to processed container
  await moveProcessedReport(blobServiceClient, fileName, processedData, context);
  
  context.log(`Successfully processed report: ${fileName}`);
}

/**
 * Validates the structure of report data
 */
function validateReportData(reportData: any, fileName: string): void {
  if (!reportData.date) {
    throw new Error(`Missing date field in ${fileName}`);
  }
  
  if (!Array.isArray(reportData.records)) {
    throw new Error(`Records field must be an array in ${fileName}`);
  }
  
  if (!reportData.metadata || typeof reportData.metadata !== 'object') {
    throw new Error(`Missing or invalid metadata in ${fileName}`);
  }
}
/**
 * Processes a single report file with retry logic
 * Implements exponential backoff for retries
 */
export async function processReportWithRetry(
  blobServiceClient: BlobServiceClient,
  fileName: string,
  context: InvocationContext
): Promise<ProcessingResult> {
  let retryCount = 0;
  let lastError: any;
  
  while (retryCount <= MAX_RETRIES) {
    try {
      await processReport(blobServiceClient, fileName, context);
      
      return {
        fileName,
        success: true,
        retryCount
      };
    } catch (error) {
      lastError = error;
      retryCount++;
      
      context.log(`Error processing ${fileName} (attempt ${retryCount})`, error);
      
      if (retryCount <= MAX_RETRIES) {
        // Exponential backoff: wait longer between retries
        const delay = RETRY_DELAY_MS * Math.pow(2, retryCount - 1);
        await sleep(delay);
      }
    }
  }
  
  // All retries failed
  return {
    fileName,
    success: false,
    error: lastError?.message || 'Unknown error',
    retryCount
  };
}

/**
 * Processes report data (placeholder for actual business logic)
 */
export async function processReportData(
  reportData: ReportData,
  context: InvocationContext
): Promise<any> {
  // Simulate processing time
  await sleep(100);
  
  // Add processing metadata
  const processedData = {
    ...reportData,
    metadata: {
      ...reportData.metadata,
      processedAt: new Date().toISOString(),
      processedBy: 'dailyReportProcessor',
      invocationId: context.invocationId
    }
  };
  
  context.log(`Processed ${reportData.records.length} records from ${reportData.date}`);
  
  return processedData;
}

/**
 * Moves processed report to the processed container
 */
export async function moveProcessedReport(
  blobServiceClient: BlobServiceClient,
  fileName: string,
  processedData: any,
  context: InvocationContext
): Promise<void> {
  const processedContainer = blobServiceClient.getContainerClient(PROCESSED_CONTAINER);
  const processedBlob = processedContainer.getBlockBlobClient(fileName);
  
  // Upload processed data
  const processedContent = JSON.stringify(processedData, null, 2);
  await processedBlob.upload(processedContent, Buffer.byteLength(processedContent));
  
  // Delete original file
  const reportsContainer = blobServiceClient.getContainerClient(REPORTS_CONTAINER);
  const originalBlob = reportsContainer.getBlobClient(fileName);
  await originalBlob.delete();
}

/**
 * Cleans up processed files and handles errors
 */
export async function cleanupProcessedFiles(
  blobServiceClient: BlobServiceClient,
  results: ProcessingResult[],
  context: InvocationContext
): Promise<void> {
  const failedFiles = results.filter(r => !r.success);
  
  if (failedFiles.length > 0) {
    context.log(`Moving ${failedFiles.length} failed files to error container`);
    
    for (const failed of failedFiles) {
      try {
        await moveToErrorContainer(blobServiceClient, failed, context);
      } catch (error) {
        context.error(`Error moving ${failed.fileName} to error container`, error);
      }
    }
  }
}

/**
 * Moves failed reports to error container
 */
export async function moveToErrorContainer(
  blobServiceClient: BlobServiceClient,
  failed: ProcessingResult,
  context: InvocationContext
): Promise<void> {
  const reportsContainer = blobServiceClient.getContainerClient(REPORTS_CONTAINER);
  const errorContainer = blobServiceClient.getContainerClient(ERROR_CONTAINER);
  
  const originalBlob = reportsContainer.getBlobClient(failed.fileName);
  const errorBlob = errorContainer.getBlobClient(failed.fileName);
  
  try {
    // Copy to error container with error metadata
    const copyResponse = await errorBlob.beginCopyFromURL(originalBlob.url);
    await copyResponse.pollUntilDone();
    
    // Add error metadata
    await errorBlob.setMetadata({
      error: failed.error || 'Unknown error',
      retryCount: failed.retryCount?.toString() || '0',
      failedAt: new Date().toISOString()
    });
    
    // Delete original
    await originalBlob.delete();
    
    context.log(`Moved failed file ${failed.fileName} to error container`);
  } catch (error) {
    context.error(`Error moving ${failed.fileName} to error container`, error);
  }
}


/**
 * Generates processing statistics
 * Calculates success rates and performance metrics
 */
export function generateProcessingStats(
  results: ProcessingResult[],
  startTime: number
): ProcessingStats {
  const successfulFiles = results.filter(r => r.success).length;
  const failedFiles = results.filter(r => !r.success).length;
  const totalRetries = results.reduce((sum, r) => sum + (r.retryCount || 0), 0);
  
  return {
    totalFiles: results.length,
    successfulFiles,
    failedFiles,
    retryCount: totalRetries,
    processingTime: Date.now() - startTime
  };
}

/**
 * Logs processing results and statistics
 * Provides detailed metrics for monitoring
 */
export function logProcessingResults(stats: ProcessingStats, context: InvocationContext): void {
  context.log('Daily report processing completed', {
    totalFiles: stats.totalFiles,
    successfulFiles: stats.successfulFiles,
    failedFiles: stats.failedFiles,
    retryCount: stats.retryCount,
    processingTimeMs: stats.processingTime,
    successRate: stats.totalFiles > 0 ? (stats.successfulFiles / stats.totalFiles * 100).toFixed(2) + '%' : '0%'
  });
}

/**
 * Utility function to convert stream to string
 * Handles blob download stream conversion
 */
async function streamToString(readableStream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    readableStream.on('data', (data) => {
      chunks.push(data instanceof Buffer ? data : Buffer.from(data));
    });
    readableStream.on('end', () => {
      resolve(Buffer.concat(chunks).toString());
    });
    readableStream.on('error', reject);
  });
}

/**
 * Utility function for delays
 * Used for retry backoff and batch processing delays
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

