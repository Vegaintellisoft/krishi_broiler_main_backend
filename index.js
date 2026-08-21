require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");

const { connectDB, query } = require("./config/db");
const auditLogger = require("./middlewares/auditLogger");

const driverRoutes = require("./routes/driverRoute");
const adminRoutes = require("./routes/adminRoute");
const materialRoutes = require("./routes/materialRoute");
const supplierRoutes = require("./routes/supplierRoute");
const poRoutes = require("./routes/poRoute");
const shippingRoutes = require("./routes/shippingRoute");
const sourceLocationRoutes = require("./routes/sourceMasterRoute");
const dcRoutes = require("./routes/dcRoute");
const unitRoutes = require("./routes/unitRoute");
const roleRoutes = require("./routes/roleRoute");
const reportRoutes = require("./routes/reportRoutes");

const broilerRoutes = require("./routes/Broiler/broilerRoutes");
const breederRoutes = require("./routes/Breeder/breederRoutes");
const feedDetailsRoutes = require('./routes/Breeder/feedDetailsRoutes');

const app = express();
app.set('trust proxy', true);
app.use(express.json());
app.use(cors());
app.set('view cache', false);

// Global Audit Logger Middleware - intercepts all POST/PUT/PATCH/DELETE calls
app.use(auditLogger);

connectDB();

const PORT = process.env.PORT || 4010;

app.get("/status", (req, res) => {
  res.send("Hello from krishi...");
});

const frontendDistPath = path.join(__dirname, 'dist');
app.use(express.static(frontendDistPath));

app.use("/api/driver", driverRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/material", materialRoutes);
app.use("/api/supplier", supplierRoutes);
app.use("/api/po", poRoutes);
app.use("/api/shipping", shippingRoutes);
app.use("/api/source", sourceLocationRoutes);
app.use("/api/dc", dcRoutes);
app.use("/api/unit", unitRoutes);
app.use("/api/roles", roleRoutes);
app.use("/api/reports", reportRoutes);

app.use('/challans', express.static(path.join(process.cwd(), 'challans'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    }
  },
}));

app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.pdf')) {
      res.setHeader('Content-Type', 'application/pdf');
    }
  },
}));

// Broiler API
app.use("/api/broiler", broilerRoutes);

app.post("/api/db/add-unique-constrains", async (req, res) => {
  try {
    const { dbname, uniqueFields } = req.body;

    if (!dbname || !Array.isArray(uniqueFields) || uniqueFields.length === 0) {
      return res.status(400).json({
        message: "dbname and uniqueFields[] are required"
      });
    }

    const schema = "broiler";
    const isValidIdentifier = (str) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(str);

    if (!isValidIdentifier(dbname)) {
      return res.status(400).json({ message: "Invalid table name" });
    }

    for (const field of uniqueFields) {
      if (!isValidIdentifier(field)) {
        return res.status(400).json({ message: `Invalid column name: ${field}` });
      }
    }

    const constraintName = `${dbname}_unique_${uniqueFields.join("_")}`;

    const notNullQuery = `
      ALTER TABLE ${schema}.${dbname}
      ${uniqueFields
        .map((field) => `ALTER COLUMN ${field} SET NOT NULL`)
        .join(",\n      ")};
    `;

    const uniqueQuery = `
      ALTER TABLE ${schema}.${dbname}
      ADD CONSTRAINT ${constraintName}
      UNIQUE (${uniqueFields.join(", ")});
    `;

    await query(notNullQuery);
    await query(uniqueQuery);

    return res.status(200).json({
      message: "Unique constraint added successfully",
      constraint: constraintName
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      message: "Failed to add unique constraint",
      error: error.message
    });
  }
});

// Breeder APIs
app.use("/api/breeder", breederRoutes);
app.use('/api/breeder/feed-details', feedDetailsRoutes);

app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log("Server starts at ", process.env.SERVER_URL || 'http://localhost:4011');
});
