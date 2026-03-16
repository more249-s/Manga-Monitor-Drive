import { google } from "googleapis";
import { Readable } from "stream";
import { CONFIG } from "../utils/config.js";
import axios from "axios";
import archiver from "archiver";
import { PassThrough } from "stream";

let driveClient: ReturnType<typeof google.drive> | null = null;

function getDriveClient() {
  if (driveClient) return driveClient;

  try {
    const serviceAccountJson = JSON.parse(CONFIG.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: serviceAccountJson,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    driveClient = google.drive({ version: "v3", auth });
    return driveClient;
  } catch (err) {
    console.error("[Drive] Failed to init Google Drive client:", err);
    return null;
  }
}

export async function downloadAndUploadChapter(
  projectName: string,
  chapterNumber: number,
  imageUrls: string[]
): Promise<string | null> {
  const drive = getDriveClient();
  if (!drive) return null;
  if (!imageUrls.length) return null;

  try {
    const zipStream = new PassThrough();
    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(zipStream);

    let downloaded = 0;
    for (let i = 0; i < imageUrls.length; i++) {
      try {
        const imgRes = await axios.get(imageUrls[i], {
          responseType: "arraybuffer",
          timeout: 30000,
          headers: {
            "User-Agent": "Mozilla/5.0",
            "Referer": new URL(imageUrls[i]).origin,
          },
        });

        const ext = imageUrls[i].split(".").pop()?.split("?")[0] || "jpg";
        const filename = `page_${String(i + 1).padStart(3, "0")}.${ext}`;
        archive.append(Buffer.from(imgRes.data), { name: filename });
        downloaded++;
      } catch (imgErr) {
        console.error(`[Drive] Failed to download image ${i + 1}:`, imgErr);
      }
    }

    if (downloaded === 0) return null;

    archive.finalize();

    const folderName = `${projectName} - Chapter ${chapterNumber}`;

    const folderRes = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: "application/vnd.google-apps.folder",
        parents: [CONFIG.GOOGLE_DRIVE_FOLDER_ID],
      },
      fields: "id",
    });

    const folderId = folderRes.data.id!;

    const zipFilename = `${projectName}_Ch${chapterNumber}_RAW.zip`;
    const fileRes = await drive.files.create({
      requestBody: {
        name: zipFilename,
        parents: [folderId],
      },
      media: {
        mimeType: "application/zip",
        body: zipStream,
      },
      fields: "id, webViewLink",
    });

    await drive.permissions.create({
      fileId: folderId,
      requestBody: { role: "reader", type: "anyone" },
    });

    const link = `https://drive.google.com/drive/folders/${folderId}`;
    console.log(`[Drive] Uploaded: ${link}`);
    return link;
  } catch (err) {
    console.error("[Drive] Upload error:", err);
    return null;
  }
}
