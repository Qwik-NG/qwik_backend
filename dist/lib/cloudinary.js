"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isCloudinaryEnabled = isCloudinaryEnabled;
exports.uploadImageBuffer = uploadImageBuffer;
const cloudinary_1 = require("cloudinary");
const env_1 = require("../config/env");
if (env_1.env.cloudinaryEnabled) {
    cloudinary_1.v2.config({
        cloud_name: env_1.env.cloudinaryCloudName,
        api_key: env_1.env.cloudinaryApiKey,
        api_secret: env_1.env.cloudinaryApiSecret,
        secure: true,
    });
}
function isCloudinaryEnabled() {
    return env_1.env.cloudinaryEnabled;
}
async function uploadImageBuffer(input) {
    if (!env_1.env.cloudinaryEnabled) {
        throw new Error("Cloudinary is not configured");
    }
    const { buffer, folder = env_1.env.cloudinaryFolder, filename } = input;
    return new Promise((resolve, reject) => {
        const stream = cloudinary_1.v2.uploader.upload_stream({
            folder,
            resource_type: "image",
            use_filename: !!filename,
            unique_filename: true,
            filename_override: filename,
        }, (error, result) => {
            if (error || !result?.secure_url) {
                reject(error ?? new Error("Cloudinary upload failed"));
                return;
            }
            resolve(result.secure_url);
        });
        stream.end(buffer);
    });
}
