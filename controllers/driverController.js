const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { query } = require("../config/db");

const JWT_SECRET = process.env.JWT_SECRET || 'jdf_6bhfn8+_aj&8Pyjhbf';

// ---------------------- REGISTER ----------------------
exports.register = async (req, res) => {
    try {
       const {
  fullname,
  username,
  password,
  email,
  mobile,
  status,
  role,
  category,
  plant_id,
  emp_id,
  location_entry,
  bluetooth_entry
} = req.body;

        if (!fullname || !username || !password || !mobile || !category) {
            return res.status(400).json({ status: false, message: "All fields including category are required" });
        }

        // Check duplicate by username + mobile + category
        const existingUser = await query(
            "SELECT * FROM driver WHERE (username = $1 OR mobile = $2) AND category = $3",
            [username, mobile, category]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({ status: false, message: "Username or mobile already used in this category" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // If category is Broiler → save plant_id, else NULL
        const finalPlantId = category === "Broiler" ? plant_id || null : null;
        const finalEmpId = category === "Broiler" ? emp_id || null : null;

        const result = await query(
            `INSERT INTO driver 
                (fullname, username, password, email, mobile, status, role, category, plant_id, emp_id, location_entry, bluetooth_entry, created_at, updated_at)
             VALUES 
                ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
             RETURNING id, fullname, username, email, mobile, category, role, plant_id, emp_id, location_entry, bluetooth_entry`,
            [
                fullname,
                username,
                hashedPassword,
                email || null,
                mobile,
                status || 'active',
                role || 'user',
                category,
                finalPlantId,
                finalEmpId,
                location_entry ?? false,
                bluetooth_entry ?? false
            ]
        );

        const user = result[0];

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, category: user.category },
            JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.status(201).json({
            status: true,
            message: "Driver registered successfully",
            user,
            token
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: "Error while registering user", error: error.message });
    }
};



// ---------------------- LOGIN ----------------------
exports.login = async (req, res) => {
    try {
        const { username, password, category } = req.body;

        if (!username || !password || !category) {
            return res.status(400).json({ status: false, message: "Username, password and category are required" });
        }

        // Allow login by username, email, or mobile number (case-insensitive & trimmed)
        let result = await query(
            `SELECT * FROM driver 
             WHERE (LOWER(TRIM(username)) = LOWER(TRIM($1)) OR LOWER(TRIM(email)) = LOWER(TRIM($1)) OR mobile = $1) 
               AND LOWER(TRIM(category)) = LOWER(TRIM($2))`,
            [username, category]
        );

        if (result.length === 0) {
            // Check if user exists under a different category or with wrong username/email
            const categoryCheck = await query(
                `SELECT * FROM driver 
                 WHERE LOWER(TRIM(username)) = LOWER(TRIM($1)) OR LOWER(TRIM(email)) = LOWER(TRIM($1)) OR mobile = $1`,
                [username]
            );
            if (categoryCheck.length > 0) {
                return res.status(401).json({ 
                    status: false, 
                    message: `Category mismatch: This account is registered under category '${categoryCheck[0].category}'. Please select '${categoryCheck[0].category}' in category dropdown.` 
                });
            }
            return res.status(401).json({ status: false, message: "Invalid username, category, or password" });
        }

        const user = result[0];

        if (user.status && user.status.toLowerCase() === "inactive") {
            return res.status(403).json({ status: false, message: "You are inactivated by admin" });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ status: false, message: "Invalid username or password" });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role, category: user.category },
            JWT_SECRET,
            { expiresIn: "1h" }
        );

        delete user.password;

        // Fetch role from user_roles — also check that the role is active
        const roleResult = await query(
            "SELECT permissions, status FROM public.user_roles WHERE LOWER(TRIM(role_name)) = LOWER(TRIM($1)) AND LOWER(TRIM(category)) = LOWER(TRIM($2))",
            [user.role, user.category]
        );

        if (roleResult.length > 0) {
            const roleData = roleResult[0];
            const isRoleActive = roleData.status === true || roleData.status === "active";

            if (!isRoleActive) {
                return res.status(403).json({ status: false, message: "Your role has been deactivated. Please contact admin." });
            }
            user.permissions = roleData.permissions;
        } else {
            user.permissions = {};
        }

        // Log successful login
        await query(
            `INSERT INTO public.user_login_logs (username, fullname, role, category) 
             VALUES ($1, $2, $3, $4)`,
            [user.username, user.fullname, user.role, user.category]
        ).catch(err => console.error("Error logging driver login:", err));

        res.status(200).json({
            status: true,
            message: "Login successful",
            user,
            permissions: user.permissions || {},
            token
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: "Error during login", error: error.message });
    }
};


// ---------------------- GET ALL ----------------------
exports.getAllsimplae = async (req, res) => {
    try {
        const { category } = req.query;

        const baseQuery = `
            SELECT d.*, 
                   p.name AS plant_name
            FROM driver d
            LEFT JOIN plants p ON d.plant_id = p.plant_id
        `;

        let result;

        if (category) {
            result = await query(
                `${baseQuery} WHERE d.category = $1 ORDER BY d.created_at DESC`,
                [category]
            );
        } else {
            result = await query(
                `${baseQuery} ORDER BY d.created_at DESC`
            );
        }

        res.status(200).json({ status: true, data: result });

    } catch (error) {
        console.log(error);
        res.status(500).json({
            status: false,
            message: "Error fetching driver data",
            error: error.message
        });
    }
};


exports.getAll = async (req, res) => {
    try {
        const category = req.query.category ? String(req.query.category) : null;

        const isBroiler = category?.toLowerCase() === "broiler";

        const plantTable = isBroiler ? "broiler.plant" : "plants";
        const plantColumn = isBroiler ? "plant_name" : "name";

        const empTable = isBroiler ? "broiler.employee" : null;
        const empColumn = isBroiler ? "emp_name" : null;

        const baseQuery = `
            SELECT 
                d.*,
                COALESCE(p.${plantColumn}, d.plant_id::text) AS plant_name
                ${isBroiler ? `, COALESCE(e.${empColumn}, d.emp_id::text) AS emp_name` : ""}
            FROM driver d
            LEFT JOIN ${plantTable} p 
                ON d.plant_id::text = p.plant_id::text
            ${isBroiler ? `
            LEFT JOIN ${empTable} e
                ON d.emp_id::text = e.emp_id::text
            ` : ""}
        `;

        const queryText = category
            ? `${baseQuery} WHERE d.category = $1 ORDER BY d.created_at DESC`
            : `${baseQuery} ORDER BY d.created_at DESC`;

        const values = category ? [category] : [];

        const result = await query(queryText, values);

        res.status(200).json({ status: true, data: result });

    } catch (error) {
        console.log(error);
        res.status(500).json({
            status: false,
            message: "Error fetching driver data",
            error: error.message
        });
    }
};


// ---------------------- GET BY ID ----------------------
exports.getById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await query("SELECT * FROM driver WHERE id = $1", [id]);

        if (result.length === 0) {
            return res.status(404).json({ status: false, message: "Driver not found" });
        }

        res.status(200).json({ status: true, data: result[0] });
    } catch (error) {
        res.status(500).json({ status: false, message: "Error fetching driver by ID", error: error.message });
    }
};


exports.getById = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await query("select * from driver where id=$1", [id]);
        if (result.length === 0) {
            return res.status(401).json({ status: false, message: "Invalid username or password" });
        }

        const user = result[0];

        res.status(200).json({ status: true, data: user });
    } catch (error) {
        res.status(500).json({ status: false, message: "Error at fetching driver data", error: error });
    }
}

exports.udpateDriver = async (req, res) => {
    try {
        const { id } = req.params;
        const { fullname, username, email, password, status, mobile, role, category, plant_id, emp_id, location_entry, bluetooth_entry } = req.body;

        const driverResult = await query("SELECT * FROM driver WHERE id = $1", [id]);

        if (driverResult.length === 0) {
            return res.status(401).json({ status: false, message: "Driver not found!" });
        }

        const existingDriver = driverResult[0];
        const newCategory = category || existingDriver.category;

        // Check duplicate username/mobile within the same category only
        const existingUser = await query(
            "SELECT * FROM driver WHERE (username = $1 OR mobile = $2) AND id != $3 AND category = $4",
            [username || existingDriver.username, mobile || existingDriver.mobile, id, newCategory]
        );

        if (existingUser.length > 0) {
            return res.status(409).json({ status: false, message: "Username or mobile already in use" });
        }

        // Use old values if missing
        const newFullname = fullname || existingDriver.fullname;
        const newUsername = username || existingDriver.username;
        const newEmail = email !== undefined ? (email || null) : existingDriver.email;
        const newStatus = status || existingDriver.status;
        const newMobile = mobile || existingDriver.mobile;
        const newRole = role || existingDriver.role;
        const newLocationEntry = location_entry !== undefined ? location_entry : existingDriver.location_entry;
        const newBluetoothEntry = bluetooth_entry !== undefined ? bluetooth_entry : existingDriver.bluetooth_entry;

        // Plant ID logic
        const finalPlantId =
            newCategory === "Broiler"
                ? (plant_id || existingDriver.plant_id || null)
                : null;

        const finalEmpId =
            newCategory === "Broiler"
                ? (emp_id || existingDriver.emp_id || null)
                : null;

        let updatedDriver;

        if (!password || password === "*******") {
            updatedDriver = await query(
                `UPDATE driver
SET username = $1,
    email = $2,
    status = $3,
    fullname = $4,
    mobile = $5,
    role = $6,
    category = $7,
    plant_id = $8,
    emp_id = $9,
    location_entry = $10,
    bluetooth_entry = $11
WHERE id = $12
RETURNING *`,
                [
    newUsername,
    newEmail,
    newStatus,
    newFullname,
    newMobile,
    newRole,
    newCategory,
    finalPlantId,
    finalEmpId,
    newLocationEntry,
    newBluetoothEntry,
    id
]
            );
        } else {
            const hashed = await bcrypt.hash(password, 10);

            updatedDriver = await query(
                `UPDATE driver
SET username = $1,
    email = $2,
    password = $3,
    status = $4,
    fullname = $5,
    mobile = $6,
    role = $7,
    category = $8,
    plant_id = $9,
    emp_id = $10,
    location_entry = $11,
    bluetooth_entry = $12
WHERE id = $13
RETURNING *`,
               [
    newUsername,
    newEmail,
    hashed,
    newStatus,
    newFullname,
    newMobile,
    newRole,
    newCategory,
    finalPlantId,
    finalEmpId,
    newLocationEntry,
    newBluetoothEntry,
    id
]
            );
        }

        res.status(200).json({
            status: true,
            message: "Driver profile updated successfully",
            data: updatedDriver[0]
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({
            status: false,
            message: "Error occurred while updating the driver data",
            error: error.message
        });
    }
};





exports.deleteDriver = async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) {
            return res.status(400).json({ status: false, message: "Driver ID is required" });
        }

        const check = await query("SELECT * FROM Driver WHERE id = $1", [id]);
        if (check.length === 0) {
            return res.status(404).json({ status: false, message: "Driver not found" });
        }

        await query("DELETE FROM Driver WHERE id = $1", [id]);

        res.status(200).json({ status: true, message: "Driver deleted successfully" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: "Error occurs while deleting the driver data", error: error.message });
    }
};

// ---------------------- CHANGE PASSWORD ----------------------
exports.changePassword = async (req, res) => {
    try {
        const { id } = req.params;
        const { currentPassword, newPassword } = req.body;

        if (!id || !currentPassword || !newPassword) {
            return res.status(400).json({ status: false, message: "User ID, current password and new password are required" });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({ status: false, message: "New password must be at least 6 characters" });
        }

        const result = await query("SELECT * FROM driver WHERE id = $1", [id]);
        if (result.length === 0) {
            return res.status(404).json({ status: false, message: "User not found" });
        }

        const user = result[0];

        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            return res.status(401).json({ status: false, message: "Current password is incorrect" });
        }

        const hashed = await bcrypt.hash(newPassword, 10);
        await query("UPDATE driver SET password = $1, updated_at = NOW() WHERE id = $2", [hashed, id]);

        res.status(200).json({ status: true, message: "Password changed successfully" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ status: false, message: "Error changing password", error: error.message });
    }
};

