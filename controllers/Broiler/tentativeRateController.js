const { query } = require("../../config/db");

exports.getTentativeRates = async (req, res) => {
  try {
    const data = await query(`
      SELECT *
      FROM broiler.tentative_rate_master
      ORDER BY id DESC
    `);

    res.status(200).json({
      success: true,
      data
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ success: false });
  }
};

exports.addTentativeRate = async (req, res) => {
  const {
    start_date,
    min_rate,
    max_rate,
    created_by,
    updated_by
  } = req.body;

  if (Number(min_rate) >= Number(max_rate)) {
    return res.status(400).json({
        success: false,
        message: "Max Rate should be greater than Min Rate"
    });
}
  const duplicate = await query(`
    SELECT id
    FROM broiler.tentative_rate_master
    WHERE
        start_date = $1
        AND min_rate = $2
        AND max_rate = $3
`,
    [start_date, min_rate, max_rate]);
  console.log("Duplicate Length:", duplicate.length);
  console.log("Add Data:", start_date, min_rate, max_rate);


  if (duplicate.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Same Date, Min Rate and Max Rate already exists"
    });
  }

  try {

    const active = await query(`
      SELECT *
      FROM broiler.tentative_rate_master
      WHERE status='Active'
      LIMIT 1
    `);

    if (active.length > 0) {

      await query(`
        UPDATE broiler.tentative_rate_master
        SET
          status='Inactive',
          end_date=$1::date - INTERVAL '1 day',
          updated_at=NOW()
        WHERE id=$2
      `,
        [start_date, active[0].id]);
    }

    await query(`
  INSERT INTO broiler.tentative_rate_master
  (
    start_date,
    min_rate,
    max_rate,
    status,
    created_by,
    updated_by
  )
  VALUES
  (
    $1,$2,$3,'Active',$4,$5
  )
`,
      [
        start_date,
        min_rate,
        max_rate,
        created_by,
        updated_by
      ]);

    res.json({
      success: true,
      message: "Rate Added"
    });

  } catch (err) {
    console.log("Add Tentative Rate Error");
    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }
};

exports.updateTentativeRate = async (req, res) => {

  const { id } = req.params;
  const {
    start_date,
    min_rate,
    max_rate,
    updated_by
  } = req.body;

  if (Number(min_rate) >= Number(max_rate)) {
    return res.status(400).json({
        success: false,
        message: "Max Rate should be greater than Min Rate"
    });
}

  const duplicate = await query(`
    SELECT id
    FROM broiler.tentative_rate_master
    WHERE
        start_date = $1
        AND min_rate = $2
        AND max_rate = $3
        AND status = 'Active'
        AND id <> $4
`,
    [start_date, min_rate, max_rate, id]);
  console.log("Duplicate Length:", duplicate.length);
  console.log("Update Data:", start_date, min_rate, max_rate);

  if (duplicate.length > 0) {
    return res.status(400).json({
      success: false,
      message: "Same Date, Min Rate and Max Rate already exists"
    });
  }

  try {

    const existing = await query(`
            SELECT *
            FROM broiler.tentative_rate_master
            WHERE id = $1
        `, [id]);

    if (existing.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Record not found"
      });
    }

    const existingDate = new Date(existing[0].start_date)
      .toISOString()
      .split("T")[0];

    const requestDate = new Date(start_date)
      .toISOString()
      .split("T")[0];

    console.log("DB Date:", existingDate);
    console.log("Request Date:", requestDate);
    console.log("DB Min:", existing[0].min_rate);
    console.log("Req Min:", min_rate);
    console.log("DB Max:", existing[0].max_rate);
    console.log("Req Max:", max_rate);

    // No changes — return success without doing anything
    if (
      existingDate === requestDate &&
      Number(existing[0].min_rate) === Number(min_rate) &&
      Number(existing[0].max_rate) === Number(max_rate)
    ) {
      return res.status(200).json({
        success: true,
        message: "No changes detected. Same date and rate already exist."
      });
    }

    await query(`
            UPDATE broiler.tentative_rate_master
            SET
                end_date = $1::date - INTERVAL '1 day',
                status = 'Inactive'
            WHERE id = $2
        `, [start_date, id]);

    await query(`
    INSERT INTO broiler.tentative_rate_master
    (
        start_date,
        min_rate,
        max_rate,
        status,
        created_by,
        updated_by
    )
    VALUES
    (
        $1,$2,$3,'Active',$4,$5
    )
`,
      [
        start_date,
        min_rate,
        max_rate,
        existing[0].created_by || updated_by,
        updated_by
      ]);

    res.json({
      success: true,
      message: "Updated Successfully"
    });

  } catch (err) {
    console.log("Update Tentative Rate Error");
    console.log(err);

    res.status(500).json({
      success: false,
      message: err.message
    });
  }


};

exports.getCurrentTentativeRate = async (req, res) => {

  try {

    const data = await query(`
            SELECT *
            FROM broiler.tentative_rate_master
            WHERE status='Active'
            ORDER BY id DESC
            LIMIT 1
        `);

    res.json({
      success: true,
      data: data[0]
    });

  } catch (err) {
    console.log(err);

    res.status(500).json({
      success: false
    });
  }
};