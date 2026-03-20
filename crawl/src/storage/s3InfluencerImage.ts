/**
 * Reexport do módulo S3 (`src/s3/influencerProfileStorage.ts`) para imports existentes.
 */
export {
  attachStablePostCoversToMedia,
  attachStableProfilePicToSlim,
  injectStableProfilePicIntoMediaItems,
  influencerS3Prefix,
  resyncInfluencerS3AfterDbMediaReset,
  sanitizeHandleForS3Key,
  uploadInfluencerProfileImageToS3,
  wipeInfluencerS3Prefix,
} from '../s3/influencerProfileStorage.js';
