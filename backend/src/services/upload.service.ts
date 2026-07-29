import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../lib/supabase.js";
import { HttpError } from "../utils/http-error.js";

const PRODUCT_IMAGE_BUCKET = "product-images";
const MAX_PRODUCT_IMAGE_BYTES = 2 * 1024 * 1024;

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
};

function hasExpectedImageSignature(buffer: Buffer, contentType: string) {
  if (contentType === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (contentType === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (contentType === "image/webp") {
    return buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP";
  }

  return false;
}

let productImageBucketReady = false;

function sanitizeFileName(fileName: string, contentType: string) {
  const extension = EXTENSION_BY_MIME[contentType] ?? "png";
  const withoutExtension = fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return `${withoutExtension || "product-image"}.${extension}`;
}

async function ensureProductImageBucket() {
  if (productImageBucketReady) return;

  const { error } = await supabaseAdmin.storage.getBucket(PRODUCT_IMAGE_BUCKET);

  if (error) {
    const { error: createError } = await supabaseAdmin.storage.createBucket(PRODUCT_IMAGE_BUCKET, {
      public: true,
      allowedMimeTypes: Object.keys(EXTENSION_BY_MIME),
      fileSizeLimit: MAX_PRODUCT_IMAGE_BYTES
    });

    if (createError) {
      throw HttpError.fromSupabase(createError, "Unable to prepare product image storage");
    }
  }

  productImageBucketReady = true;
}

export async function uploadProductImage(input: {
  fileName: string;
  contentType: string;
  base64: string;
}) {
  const buffer = Buffer.from(input.base64, "base64");

  if (!buffer.byteLength) {
    throw new HttpError(400, "Image file is empty.");
  }

  if (buffer.byteLength > MAX_PRODUCT_IMAGE_BYTES) {
    throw new HttpError(400, "Product image must be 2 MB or smaller.");
  }

  if (!hasExpectedImageSignature(buffer, input.contentType)) {
    throw new HttpError(400, "The uploaded file does not match its declared image type.");
  }

  await ensureProductImageBucket();

  const safeFileName = sanitizeFileName(input.fileName, input.contentType);
  const path = `products/${randomUUID()}-${safeFileName}`;
  const { error } = await supabaseAdmin.storage
    .from(PRODUCT_IMAGE_BUCKET)
    .upload(path, buffer, {
      contentType: input.contentType,
      upsert: false
    });

  if (error) {
    throw HttpError.fromSupabase(error, "Unable to upload product image");
  }

  const { data } = supabaseAdmin.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path);

  return {
    path,
    url: data.publicUrl
  };
}
