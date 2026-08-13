const { query } = require("../config/db");

exports.getAllRoles = async (req, res) => {
    try {
        const { category } = req.params;
        let sql = "SELECT * FROM user_roles";
        const params = [];

        if (category) {
            sql += " WHERE category = $1";
            params.push(category);
        }

        sql += " ORDER BY created_at DESC;";

        const result = await query(sql, params);

        // Return empty array instead of 404 — frontend handles the empty state
        res.status(200).json({ status: true, data: result || [] });
    } catch (error) {
        console.error("Error while getting roles:", error);
        res.status(500).json({ status: false, message: "Error while getting roles", error });
    }
};


exports.addRole = async (req, res) => {
    const { role_name, status, permissions, category } = req.body;
    console.log(req.body);

    if (!role_name || !status || !permissions || !category) {
        return res.status(400).json({
            status: false,
            message: "Missing required fields: role_name, status, permissions, category"
        });
    }

    try {
        const result = await query(
            "INSERT INTO user_roles (role_name, status, created_at, permissions, category) VALUES ($1, $2, CURRENT_TIMESTAMP, $3, $4) RETURNING *;",
            [role_name, status, JSON.stringify(permissions), category]
        );

        res.status(201).json({
            status: true,
            message: "Role added successfully",
            data: result[0]
        });
    } catch (error) {
        console.log("Error while adding role: ", error);
        res.status(500).json({
            status: false,
            message: "Error while adding role",
            error: error
        });
    }
};

exports.updateRole = async (req, res) => {
    const { id } = req.params;
    const { role_name, status, permissions, category } = req.body;

    if (role_name == null && status == null && permissions == null && category == null) {
        return res.status(400).json({
            status: false,
            message: "No data to update"
        });
    }

    try {
        const result = await query(
            `UPDATE user_roles SET
                role_name = COALESCE($1, role_name),
                status = COALESCE($2, status),
                permissions = COALESCE($3, permissions),
                category = COALESCE($4, category)
            WHERE id = $5
            RETURNING *;`,
            [role_name, status, JSON.stringify(permissions), category, id]
        );

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: `Role with ID ${id} not found`
            });
        }

        res.status(200).json({
            status: true,
            message: "Role updated successfully",
            data: result[0]
        });
    } catch (error) {
        console.log("Error while updating role: ", error);
        res.status(500).json({
            status: false,
            message: "Error while updating role",
            error: error
        });
    }
};


exports.deleteRole = async (req, res) => {
    const { id } = req.params;

    try {
        const result = await query(
            "DELETE FROM user_roles WHERE id = $1 RETURNING *;",
            [id]
        );

        if (result.length === 0) {
            return res.status(404).json({
                status: false,
                message: `Role with ID ${id} not found`
            });
        }

        res.status(200).json({
            status: true,
            message: "Role deleted successfully",
            data: result[0]
        });
    } catch (error) {
        console.log("Error while deleting role: ", error);
        res.status(500).json({
            status: false,
            message: "Error while deleting role",
            error: error
        });
    }
};

exports.checkUsersWithRole = async (req, res) => {
    const { id } = req.params;
    try {
        const roleQuery = await query("SELECT role_name, category FROM user_roles WHERE id = $1", [id]);
        if (roleQuery.length === 0) {
            return res.status(404).json({ status: false, message: "Role not found" });
        }
        const role = roleQuery[0];

        const admins = await query(
            "SELECT id, username, first_name, last_name, category FROM Admin WHERE role = $1 AND category = $2",
            [role.role_name, role.category]
        );

        const drivers = await query(
            "SELECT id, username, fullname, category FROM driver WHERE role = $1 AND category = $2",
            [role.role_name, role.category]
        );

        const allUsers = [
            ...admins.map(u => ({ username: u.username, name: `${u.first_name || ''} ${u.last_name || ''}`.trim() || u.username, type: 'Admin' })),
            ...drivers.map(u => ({ username: u.username, name: u.fullname || u.username, type: 'User' }))
        ];

        res.status(200).json({
            status: true,
            hasUsers: allUsers.length > 0,
            users: allUsers,
            role_name: role.role_name,
            category: role.category
        });
    } catch (error) {
        console.error("Error in checkUsersWithRole:", error);
        res.status(500).json({ status: false, message: "Server error", error });
    }
};

exports.reassignAndDeleteRole = async (req, res) => {
    const { id } = req.params;
    const { new_role_name } = req.body;

    try {
        const roleQuery = await query("SELECT role_name, category FROM user_roles WHERE id = $1", [id]);
        if (roleQuery.length === 0) {
            return res.status(404).json({ status: false, message: "Role not found" });
        }
        const role = roleQuery[0];

        if (new_role_name && new_role_name !== role.role_name) {
            // Reassign users to the new role in both tables
            await query(
                "UPDATE Admin SET role = $1 WHERE role = $2 AND category = $3",
                [new_role_name, role.role_name, role.category]
            );
            await query(
                "UPDATE driver SET role = $1 WHERE role = $2 AND category = $3",
                [new_role_name, role.role_name, role.category]
            );
        }

        // Delete the original role
        await query("DELETE FROM user_roles WHERE id = $1", [id]);

        res.status(200).json({ status: true, message: "Role deleted successfully" });
    } catch (error) {
        console.error("Error in reassignAndDeleteRole:", error);
        res.status(500).json({ status: false, message: "Server error", error });
    }
};

