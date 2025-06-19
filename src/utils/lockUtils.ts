import { BlobServiceClient } from "@azure/storage-blob";
import { InvocationContext } from "@azure/functions";
/**
 * Checks if another instance of the processor is currently running
 * Uses blob storage as a distributed lock mechanism
 */
export async function checkConcurrentExecution(
  blobServiceClient: BlobServiceClient,
  lockKey: string,
  context: InvocationContext
): Promise<boolean> {
  try {
    const lockContainer = blobServiceClient.getContainerClient('processor-locks');
    const lockBlob = lockContainer.getBlobClient(lockKey);
    
    const exists = await lockBlob.exists();
    if (exists) {
      // Check if lock is stale (older than 1 hour)
      const properties = await lockBlob.getProperties();
      const lockAge = Date.now() - properties.lastModified!.getTime();
      
      if (lockAge > 3600000) { // 1 hour in milliseconds
        context.log('Stale lock detected, removing it');
        await lockBlob.delete();
        return false;
      }
      return true;
    }
    return false;
  } catch (error) {
    context.error('Error checking concurrent execution', error);
    return false;
  }
}

/**
 * Creates a processing lock to prevent concurrent executions
 */
export async function createProcessingLock(
  blobServiceClient: BlobServiceClient,
  lockKey: string,
  context: InvocationContext
): Promise<void> {
  try {
    const lockContainer = blobServiceClient.getContainerClient('processor-locks');
    await lockContainer.createIfNotExists();
    
    const lockBlob = lockContainer.getBlockBlobClient(lockKey);
    const lockData = JSON.stringify({
      startTime: new Date().toISOString(),
      processId: context.invocationId
    });
    
    await lockBlob.upload(lockData, Buffer.byteLength(lockData));
    context.log('Processing lock created successfully');
  } catch (error) {
    context.error('Error creating processing lock', error);
    throw error;
  }
}

/**
 * Removes the processing lock
 */
export async function removeProcessingLock(
  blobServiceClient: BlobServiceClient,
  lockKey: string,
  context: InvocationContext
): Promise<void> {
  try {
    const lockContainer = blobServiceClient.getContainerClient('processor-locks');
    const lockBlob = lockContainer.getBlobClient(lockKey);
    
    await lockBlob.deleteIfExists();
    context.log('Processing lock removed successfully');
  } catch (error) {
    context.error('Error removing processing lock', error);
  }
}
