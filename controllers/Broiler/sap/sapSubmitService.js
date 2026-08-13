const axios = require("axios");
const qs = require("qs");
const broilerDataEntry = require("./broilerDataEntry.json");


const getDOCMaterialData = async (plant, farmer) => {
  let qsString = qs.stringify(
    { "sap-client": "500", werks: plant, lifnr: farmer },
    { encode: true }
  );
  const finalUrl = `${process.env.BROILER_SAP_BASE_URL}/zdaily_mort?${qsString}`;
  console.log("final url get : ", finalUrl);

  let config = {
    method: 'get',
    maxBodyLength: Infinity,
    url: finalUrl,
    auth: {
      username: process.env.BROILER_SAP_USERNAME,
      password: process.env.BROILER_SAP_PASSWORD
    }
  };

  const response = await axios.request(config);

  if (response.status !== 200) {
    return { status: false, data: "sap error" }
  }

  const dmcDet = response.data?.[0]?.dmcDet?.[0];

  if (!dmcDet) {
    return { status: false, data: "No dmcDet data found" }
  }

  const result = {
    matnr: dmcDet.matnr,
    maktx: dmcDet.maktx,
    meins: dmcDet.meins,
    enmng: dmcDet.enmng,
    // Standard values provided by SAP GET based on bird age
    zzSbwt: dmcDet.zzSbwt,   // Standard Body Weight
    zzStdg: dmcDet.zzStdg,   // Standard daily given (D.F.I STD Grams)
    zzScf: dmcDet.zzScf     // Standard Stock cum feed (STD CFI Per Bird)
  };
  console.log(result)

  return { status: true, data: result }
}

const formatDataToSap = (sapName, data) => {
  const config = broilerDataEntry[sapName];
  if (!config) {
    console.warn(`No configuration found for ${sapName}`);
    return {};
  }

  // ✅ FARM ACTIVITY SPECIAL CASE
  if (sapName === "farm_activity") {
    console.log("Reason Code:", data.reason);
    console.log("Reason Text:", data.reason_text);
    const mappedRow = {};

    config.fields.forEach(({ sap, body_key }) => {
      if (data[body_key] !== undefined) {
        mappedRow[sap] = data[body_key];
      }
    });
    console.log("Mapped Row:", mappedRow);

    const dmcDet = [
      {
        // zdmcNo: data.doc_no,
        // zeile: data.zeile || 1,
        // zzline: data.line,
        // zzlineN: data.line_name,
        // name1: data.farmer_name,
        // budat: data.posting_date,
        // bldat: data.document_date,
        // zshedLno: data.shed,
        ...mappedRow
      }
    ];

    // 🔹 Step 3: Build dmcFeed dynamically
    const dmcFeed = (data.materials || []).map((item) => ({
      matnr: item.material,
      maktx: item.material_label,
      // meins: "KG", // or derive if you have it
      stock: Number(item.stock) || 0,
      erfmg: Number(item.qty) || 0,
      ...mappedRow
    }));

    return { dmcDet, dmcFeed };
  }

  const mappedRow = {};

  config.fields.forEach(({ sap, body_key }) => {
    if (data[body_key] !== undefined) {
      mappedRow[sap] = data[body_key];
    } else {
      console.warn(`Missing field: ${body_key}`);
    }
  });

  return mappedRow;
};


const sapSubmit = async (sapName, data) => {
  try {

    let sapPayload = null;

    if (sapName !== "issue_medicine" && sapName !== "feed_transfer") {
      sapPayload = formatDataToSap(sapName, data);
      console.log("sap submit payload : ", sapPayload);
    }


    let doc_mat = null;

    if (sapName === "farm_activity") {
      const doc_material = await getDOCMaterialData(data.plant, data.farmer)
      console.log("===============")
      console.log(doc_material)
      console.log("===============")
      if (doc_material.status) {
        doc_mat = doc_material.data
      }
    }


    if (sapName === "farm_activity" && doc_mat && sapPayload.dmcDet?.length) {
      sapPayload.dmcDet = sapPayload.dmcDet.map(item => ({
        ...item,
        ...doc_mat
      }));
      console.log(sapPayload.dmcDet)
    }

    let qsString = "";

    if (sapName === "farm_activity") {
      qsString = qs.stringify(
        {
          "sap-client": "500",
          dmcDet: JSON.stringify(sapPayload.dmcDet),
          dmcFeed: JSON.stringify(sapPayload.dmcFeed)
        },
        { encode: true }
      );
    } else if (sapName === "issue_medicine" || sapName === "feed_transfer") {
      qsString = qs.stringify(
        {
          "sap-client": "500",
          sio: JSON.stringify(data)
        },
        { encode: true }
      );
    } else if (sapName === "feed_return") {
      qsString = qs.stringify(
        {
          "sap-client": "500",
          sio: JSON.stringify([sapPayload])
        },
        { encode: true }
      );
    } else {
      qsString = qs.stringify(
        { "sap-client": "500", ...sapPayload },
        { encode: true }
      );
    }


    const finalUrl = `${process.env.BROILER_SAP_BASE_URL}${broilerDataEntry[sapName].sapEndpoint}?${qsString}`;

    console.log("final url : ", finalUrl);

    let config = {
      method: 'post',
      maxBodyLength: Infinity,
      url: finalUrl,
      auth: {
        username: process.env.BROILER_SAP_USERNAME,
        password: process.env.BROILER_SAP_PASSWORD
      }
    };

    const response = await axios.request(config);
    // console.log("Background SAP Response:", response);

    if (response.status !== 200) {
      console.log("sap failed")
      console.log(response.reason)
      return { status: false, data: "sap error" }
    }
    // console.log("Background SAP Response:", response.data);
    console.log("Background SAP Response status:", response.status);
    // console.log("Background SAP Response:", response.statusText);

    return { status: true, data: response }
  } catch (error) {
    return { status: false, data: error }
  }
}

module.exports = { sapSubmit };