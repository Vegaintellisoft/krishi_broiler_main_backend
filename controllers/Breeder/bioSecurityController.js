const pool = require("../../config/db");

// CREATE
exports.createBioSecurity = async (req, res) => {
  console.log("***************");
  try {
    let {
      farm_routine,
      water_quality,
      feed_inventory,
      fly_and_feather_control,
      flock_inventory,
    } = req.body;

    console.log("--- Received Body ---");
    console.log("Farm Routine Raw:", farm_routine);
    console.log("Water Quality Raw:", water_quality);
    console.log("Files received:", req.files ? req.files.length : 0);

    // Helper to parse if string
    const parseIfNeeded = (data) => {
      if (typeof data === 'string') {
        try { return JSON.parse(data); } catch (e) {
          console.error("JSON Parse Error:", e);
          return {};
        }
      }
      return data || {};
    };

    farm_routine = parseIfNeeded(farm_routine);
    water_quality = parseIfNeeded(water_quality);
    feed_inventory = parseIfNeeded(feed_inventory);
    fly_and_feather_control = parseIfNeeded(fly_and_feather_control);
    flock_inventory = parseIfNeeded(flock_inventory);

    console.log("--- Parsed Data ---");
    console.log("Farm Routine:", JSON.stringify(farm_routine, null, 2));
    console.log("Water Quality:", JSON.stringify(water_quality, null, 2));

    // Map files to the json structure
    // Frontend appends images in this order: farm, water, feed, fly, flock
    // Inside each, it iterates Object.keys (numeric keys "1", "2"...)

    const files = req.files || [];
    let fileIndex = 0;

    const categories = [
      farm_routine,
      water_quality,
      feed_inventory,
      fly_and_feather_control,
      flock_inventory
    ];

    categories.forEach(categoryMap => {
      if (!categoryMap) return;
      // Sort keys numerically to match frontend iteration order
      const sortedKeys = Object.keys(categoryMap).sort((a, b) => parseInt(a) - parseInt(b));

      sortedKeys.forEach(key => {
        const item = categoryMap[key];

        // Helper to recursively find and map 'fileNames' in the object tree
        // The frontend appends files in specific order. We just need to find
        // every occurrence of 'fileNames' array in 'item' and map files to it.
        // We traverse the item structure (same order as frontend uses to append).

        const traverseAndMap = (obj) => {
          if (!obj || typeof obj !== 'object') return;

          // If we found a fileNames array we need to fill
          if (Array.isArray(obj.fileNames) && obj.fileNames.length > 0) {
            const newFileNames = [];
            for (let i = 0; i < obj.fileNames.length; i++) {
              if (fileIndex < files.length) {
                newFileNames.push(files[fileIndex].filename);
                fileIndex++;
              }
            }
            obj.fileNames = newFileNames;
          }

          // Recursively check children
          // For 'Plain Water Before' and 'Medicine Water After', they are properties of 'obj'
          // We can iterate keys. To ensure order matches frontend, we might need a stable order.
          // Frontend: 
          // 1. Root files (extractFiles(cleanItemData))
          // 2. "Plain Water Before"
          // 3. "Medicine Water After"

          // The generic traversal might be tricky if order matters strictly.
          // Frontend hardcodes the order: Root -> Plain Water -> Medicine Water.
          // So we should replicate that specific check for Water Quality items, 
          // or just generally traverse properties.
          // For now, let's explicitly handle the known sub-keys if they exist, 
          // after handling root.

          ["Plain Water Before", "Medicine Water After"].forEach(subInfo => {
            if (obj[subInfo]) {
              traverseAndMap(obj[subInfo]);
            }
          });
        };

        // 1. Handle root level fileNames (old behavior & standard behavior)
        if (Array.isArray(item.fileNames)) {
          const newFileNames = [];
          for (let i = 0; i < item.fileNames.length; i++) {
            if (fileIndex < files.length) {
              newFileNames.push(files[fileIndex].filename);
              fileIndex++;
            }
          }
          item.fileNames = newFileNames;
        }

        // 2. Handle nested keys ('Plain Water Before' etc)
        // Ensure this matches the ORDER in frontend: extractFiles(root), then subKeys.
        ["Plain Water Before", "Medicine Water After"].forEach(subKey => {
          if (item[subKey]) {
            traverseAndMap(item[subKey]);
          }
        });
      });
    });

    const result = await pool.query(
      `INSERT INTO bio_security
       (farm_routine, water_quality, feed_inventory, fly_and_feather_control, flock_inventory)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        JSON.stringify(farm_routine),
        JSON.stringify(water_quality),
        JSON.stringify(feed_inventory),
        JSON.stringify(fly_and_feather_control),
        JSON.stringify(flock_inventory),
      ]
    );

    res.status(201).json(result[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
};

// READ ALL
exports.getAllBioSecurity = async (req, res) => {
  try {
    const result = await pool.query(`SELECT * FROM bio_security ORDER BY id DESC`);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// READ ONE
exports.getBioSecurityById = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM bio_security WHERE id = $1`,
      [req.params.id]
    );

    res.json(result[0]);
    console.log(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// UPDATE
exports.updateBioSecurity = async (req, res) => {
  try {
    const {
      farm_routine,
      water_quality,
      feed_inventory,
      fly_and_feather_control,
      flock_inventory,
    } = req.body;

    const result = await pool.query(
      `UPDATE bio_security
       SET farm_routine=$1,
           water_quality=$2,
           feed_inventory=$3,
           fly_and_feather_control=$4,
           flock_inventory=$5,
           updated_at=NOW()
       WHERE id=$6
       RETURNING *`,
      [
        farm_routine,
        water_quality,
        feed_inventory,
        fly_and_feather_control,
        flock_inventory,
        req.params.id,
      ]
    );

    res.json(result[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// DELETE
exports.deleteBioSecurity = async (req, res) => {
  try {
    await pool.query(`DELETE FROM bio_security WHERE id=$1`, [
      req.params.id,
    ]);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
