/**
 * Avatars arrive from the profile screens as base64 data URLs. Storing those in
 * MongoDB makes every profile read drag the whole image along (a 465KB avatar
 * turned /employees/profile into a 476KB, ~2.4s response), and every document
 * save writes it back again.
 *
 * So: write the image to /uploads/avatars once and store only its URL.
 */
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
const PUBLIC_PREFIX = '/uploads/avatars';

const EXTENSIONS = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif'
};

const MAX_BYTES = 5 * 1024 * 1024;

export const isDataUrlAvatar = (value) => typeof value === 'string' && value.startsWith('data:image/');

/**
 * Turn a data-URL avatar into a file and return its public path.
 * Anything else (existing URL, initials like "DP", empty) is returned unchanged,
 * and any failure falls back to the original value — a broken avatar must never
 * fail a profile update.
 */
export const persistAvatar = async (avatar, ownerKey = 'user') => {
    if (!isDataUrlAvatar(avatar)) return avatar;

    const match = /^data:(image\/[a-zA-Z+]+);base64,(.+)$/s.exec(avatar);
    if (!match) return avatar;

    const [, mime, base64] = match;
    const ext = EXTENSIONS[mime.toLowerCase()];
    if (!ext) return avatar;

    try {
        const buffer = Buffer.from(base64, 'base64');
        if (!buffer.length || buffer.length > MAX_BYTES) return avatar;

        await fs.mkdir(AVATAR_DIR, { recursive: true });
        const safeOwner = String(ownerKey).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'user';
        const fileName = `${safeOwner}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
        await fs.writeFile(path.join(AVATAR_DIR, fileName), buffer);

        return `${PUBLIC_PREFIX}/${fileName}`;
    } catch (err) {
        logger.warn({ err: err.message }, 'Could not store avatar as a file; keeping it inline');
        return avatar;
    }
};

/**
 * Avatar safe to copy into another document (e.g. booking.assignedTo.avatar).
 * An inline data URL would be duplicated into every booking — 465KB per copy —
 * so those are dropped; the employee record remains the source of truth.
 */
export const copyableAvatar = (avatar) => (isDataUrlAvatar(avatar) ? undefined : avatar);
