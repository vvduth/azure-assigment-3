import { BlobServiceClient } from "@azure/storage-blob";
import { InvocationContext } from "@azure/functions";

/**
 * checks of another instance of the processor is running
 * @param blobServiceClient 
 * @param lockKey 
 * @param context 
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
        // check if the lock is stale
        const properties = await lockBlob.getProperties();
        const lockAge = Date.now() - properties.lastModified!.getTime();

        if (lockAge > 1 * 60 * 60 * 1000) { // 1 hours
             context.log('Stale lock detected, removing it');
        await lockBlob.delete();
        return false;
        }
        return true; // Another instance is running
    }
    return false; // No lock found, safe to proceed
    } catch (error) {
        context.log('Error checking concurrent execution', error);
    return false;
    }
}