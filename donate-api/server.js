const express = require("express");
const rateLimit = require("express-rate-limit").rateLimit;
const multer = require("multer");

const app = express();
app.set("trust proxy", 1);
const maxImageSize = 5 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: maxImageSize,
    files: 1,
    fields: 3,
    parts: 4
  },
  fileFilter: (request, file, callback) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      callback(new Error("Choose a JPEG, PNG, GIF, or WebP image."));
      return;
    }

    callback(null, true);
  }
});

function getImageType(buffer) {
  if (buffer.length >= 8
      && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (buffer.length >= 3
      && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (buffer.length >= 6) {
    const signature = buffer.toString("ascii", 0, 6);
    if (signature === "GIF87a" || signature === "GIF89a") {
      return { mimeType: "image/gif", extension: "gif" };
    }
  }
  if (buffer.length >= 12
      && buffer.toString("ascii", 0, 4) === "RIFF"
      && buffer.toString("ascii", 8, 12) === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }

  return null;
}

function getConfiguration() {
  const required = ["RESEND_API_KEY", "MAIL_FROM", "MAIL_TO", "ALLOWED_ORIGIN"];
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  const allowedOrigin = new URL(process.env.ALLOWED_ORIGIN).origin;
  const recipients = process.env.MAIL_TO.split(",").map((email) => email.trim()).filter(Boolean);
  if (!recipients.length) {
    throw new Error("MAIL_TO must contain at least one recipient email address.");
  }

  return {
    apiKey: process.env.RESEND_API_KEY,
    from: process.env.MAIL_FROM,
    recipients,
    allowedOrigin
  };
}

function cleanFilename(filename, extension) {
  const baseName = filename.replace(/\\/g, "/").split("/").pop();
  const nameWithoutExtension = baseName.replace(/\.[^.]*$/, "");
  const safeName = nameWithoutExtension
    .replace(/[^\w.-]/g, "_")
    .replace(/^\.+/, "")
    .slice(0, 100);
  return `${safeName || "board-game-image"}.${extension}`;
}

app.get("/health", (request, response) => {
  response.json({ status: "ok" });
});

app.use((request, response, next) => {
  let configuration;
  try {
    configuration = getConfiguration();
  } catch (error) {
    console.error(error.message);
    response.status(503).json({ error: "The donation service is not configured yet." });
    return;
  }

  const origin = request.get("Origin");
  if (origin && origin !== configuration.allowedOrigin) {
    response.status(403).json({ error: "This website is not allowed to submit donations." });
    return;
  }
  if (origin) {
    response.set("Access-Control-Allow-Origin", configuration.allowedOrigin);
    response.set("Vary", "Origin");
  }
  if (request.method === "OPTIONS") {
    response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    response.set("Access-Control-Allow-Headers", "Content-Type");
    response.status(204).end();
    return;
  }

  request.mailConfiguration = configuration;
  next();
});

app.post(
  "/api/donations",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Too many submissions. Please try again in a little while." }
  }),
  upload.single("gameImage"),
  async (request, response, next) => {
    try {
      const { senderEmail, senderContact, message } = request.body;
      const image = request.file;

      if (!image) {
        response.status(400).json({ error: "Please choose an image of the board game." });
        return;
      }
      if (typeof senderEmail !== "string"
          || senderEmail.length > 254
          || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail.trim())) {
        response.status(400).json({ error: "Enter a valid email address." });
        return;
      }
      if (typeof senderContact !== "string"
          || !senderContact.trim()
          || senderContact.length > 200) {
        response.status(400).json({ error: "Enter contact details up to 200 characters long." });
        return;
      }
      if (typeof message !== "string" || !message.trim() || message.length > 5000) {
        response.status(400).json({ error: "Enter a message up to 5,000 characters long." });
        return;
      }

      const imageType = getImageType(image.buffer);
      if (!imageType || imageType.mimeType !== image.mimetype) {
        response.status(400).json({ error: "The uploaded file is not a supported image." });
        return;
      }

      const filename = cleanFilename(image.originalname, imageType.extension);
      const emailResponse = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${request.mailConfiguration.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          from: request.mailConfiguration.from,
          to: request.mailConfiguration.recipients,
          reply_to: senderEmail.trim(),
          subject: `Board game donation: ${filename}`,
          text: [
            `Sender email: ${senderEmail.trim()}`,
            `Contact: ${senderContact.trim()}`,
            "",
            "Message:",
            message.trim()
          ].join("\n"),
          attachments: [{
            filename,
            content: image.buffer.toString("base64")
          }]
        })
      });

      if (!emailResponse.ok) {
        let providerError;
        try {
          providerError = await emailResponse.json();
        } catch (error) {
          providerError = null;
        }
        console.error("Email provider rejected the donation email:", {
          status: emailResponse.status,
          name: providerError?.name,
          message: providerError?.message
        });
        response.status(502).json({ error: "The email service could not send your submission. Please try again later." });
        return;
      }

      response.status(200).json({ message: "Your submission was sent successfully." });
    } catch (error) {
      next(error);
    }
  }
);

app.use((error, request, response, next) => {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    response.status(413).json({ error: "The image must be 5 MB or smaller." });
    return;
  }
  if (error.message === "Choose a JPEG, PNG, GIF, or WebP image.") {
    response.status(400).json({ error: error.message });
    return;
  }

  console.error("Donation submission failed:", error);
  response.status(500).json({ error: "The submission could not be sent. Please try again later." });
});

if (require.main === module) {
  try {
    getConfiguration();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const port = Number(process.env.PORT) || 10000;
  app.listen(port, "0.0.0.0", () => {
    console.log(`Meeple donation API listening on port ${port}.`);
  });
}

module.exports = { app, getImageType };
