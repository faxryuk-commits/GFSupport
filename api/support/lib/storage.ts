/**
 * Media storage utility with Cloudflare R2 support
 * Falls back to Telegram URLs if R2 is not configured
 * 
 * Required env vars for R2:
 * - R2_ACCOUNT_ID
 * - R2_ACCESS_KEY_ID
 * - R2_SECRET_ACCESS_KEY
 * - R2_BUCKET_NAME
 * - R2_PUBLIC_URL (optional, for custom domain)
 */

// Check if R2 is configured
function isR2Configured(): boolean {
  return !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY_ID &&
    process.env.R2_SECRET_ACCESS_KEY &&
    process.env.R2_BUCKET_NAME
  )
}

// Get S3 client for R2
async function getS3Client() {
  if (!isR2Configured()) return null
  
  try {
    const { S3Client } = await import('@aws-sdk/client-s3')
    
    return new S3Client({
      region: 'auto',
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
    })
  } catch (e) {
    console.error('Failed to initialize S3 client:', e)
    return null
  }
}

/**
 * Upload media file to R2
 * @param fileBuffer - File content as ArrayBuffer or Buffer
 * @param fileName - Original file name
 * @param contentType - MIME type
 * @returns Public URL of uploaded file, or null if failed
 */
export async function uploadMedia(
  fileBuffer: ArrayBuffer | Buffer,
  fileName: string,
  contentType: string
): Promise<string | null> {
  const s3 = await getS3Client()
  if (!s3) {
    console.log('R2 not configured, skipping upload')
    return null
  }
  
  try {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3')
    
    // Generate unique key
    const timestamp = Date.now()
    const random = Math.random().toString(36).slice(2, 8)
    const ext = fileName.split('.').pop() || 'bin'
    const key = `support/${timestamp}_${random}.${ext}`
    
    await s3.send(new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: Buffer.from(fileBuffer),
      ContentType: contentType,
    }))
    
    // Return public URL
    const publicUrl = process.env.R2_PUBLIC_URL 
      ? `${process.env.R2_PUBLIC_URL}/${key}`
      : `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${key}`
    
    return publicUrl
  } catch (e) {
    console.error('R2 upload failed:', e)
    return null
  }
}

/**
 * Download file from URL and upload to R2
 * Useful for backing up Telegram media
 */
export async function backupMediaFromUrl(
  sourceUrl: string,
  fileName: string
): Promise<string | null> {
  if (!isR2Configured()) return null
  
  try {
    // Download file
    const response = await fetch(sourceUrl)
    if (!response.ok) {
      console.error('Failed to download media:', response.status)
      return null
    }
    
    const buffer = await response.arrayBuffer()
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    
    // Upload to R2
    return await uploadMedia(buffer, fileName, contentType)
  } catch (e) {
    console.error('Backup media failed:', e)
    return null
  }
}

/**
 * Delete media from R2
 */
export async function deleteMedia(key: string): Promise<boolean> {
  const s3 = await getS3Client()
  if (!s3) return false
  
  try {
    const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
    
    await s3.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
    }))
    
    return true
  } catch (e) {
    console.error('R2 delete failed:', e)
    return false
  }
}

/**
 * Get storage status
 */
export function getStorageStatus() {
  return {
    r2Configured: isR2Configured(),
    bucket: process.env.R2_BUCKET_NAME || null,
    publicUrl: process.env.R2_PUBLIC_URL || null,
  }
}
