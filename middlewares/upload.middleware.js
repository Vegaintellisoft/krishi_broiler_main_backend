const multer = require("multer");
const path = require("path");
const fs = require("fs"); // Import fs

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // 1. Define the absolute path on the hard drive
    const destPath = path.join(process.cwd(), "uploads", "bio_security");

    // 2. Create it if it doesn't exist (prevents 'ENOENT' errors)
    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(destPath, { recursive: true });
    }

    cb(null, destPath);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

module.exports = upload;
