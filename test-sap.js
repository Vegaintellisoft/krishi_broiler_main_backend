require("dotenv").config();
const axios = require("axios");
const qs = require("qs");

const SAP_BASE_URL = process.env.SAP_BASE_URL;
const SAP_USERNAME = process.env.SAP_USERNAME;
const SAP_PASSWORD = process.env.SAP_PASSWORD;

const payload = {
  id: 3022,
  BLDAT: "2026-05-08",
  XBLNR: "DC/6/NGE/00001",
  ZTO: "No. 293/1,, KRISHI NUTRITION COMPANY PRIVATE LIMITED, Kottamangalam Village, Tiruppur Main Road, Gudimangalam (Po), Varatharajapuram,, Udumalpet (Taluk), , Tiruppur, Tamil Nadu, 642201, 33AAFCK3415K1ZO",
  ZADDRESS: "Krishi Nutrition Company Private Limited, C/o Railway Goodshed, Namakkal, Namakkal, Tamil Nadu, 637001, 33AAFCK3415K1ZO",
  ZTRUCK_NO: "TN10AB1020",
  MAKTX: "MAIZE",
  MATNR: "FR000017",
  ZHSN_CODE: "10059000",
  MENGED: "1.999",
  ZRATE: "20300.00",
  ZCGST_PER: "0.00",
  ZSGST_PER: "0.00",
  ZTAXABLE_VAL: "40579.70",
  ZCGST_AMT: "0.00",
  ZSGST_AMT: "0.00",
  ZGROSS_AMT: "40579.70",
  ZEWAY: "",
  ZSD_DISTANCE: 0,
  ZSTATUS: "Active",
  ZREASON: "-",
  ZPO_NO: "4600000634",
  ZNO_OF_BAGS: "1",
  ZRR_NO: "282000097/NDL",
  ZTOKEN: "ED/6/NMKL/097NDL/00001",
  ZVBELN: "152/Dt:25.04.2026",
  ZSUPPLR: 190,
  AEDAT: "2026-05-08",
  ZRR_DATE: null,
  ZSUPP_NAME: "MARUTHI ENTERPRISES",
  ZSUP_INV_DATE: null,
  LFUHR: "2026-05-08",
  MEINS: "Mt",
  FKART: "Exempted",
  FKDAT: "2026-05-08",
  ZEWAY_STATUS: "-",
  ZCANC_REASON: "-",
  ZBRANCH: "VPM Feed Mill,",
  PO_DATE: "-",
};

const qsString = qs.stringify(
  { "sap-client": "500", ...payload },
  { encode: true }
);

const finalUrl = `${SAP_BASE_URL}?${qsString}`;

console.log("\n=== SAP CONFIG ===");
console.log("SAP_BASE_URL:", SAP_BASE_URL);
console.log("SAP_USERNAME:", SAP_USERNAME);
console.log("SAP_PASSWORD:", SAP_PASSWORD ? "***set***" : "NOT SET");
console.log("URL Length:", finalUrl.length);
console.log("\n=== FULL SAP URL ===");
console.log(finalUrl);
console.log("\n=== SENDING REQUEST ===");

axios
  .post(finalUrl, null, {
    auth: { username: SAP_USERNAME, password: SAP_PASSWORD },
    headers: { Accept: "application/json" },
    timeout: 15000,
  })
  .then((res) => {
    console.log("\n✅ SAP SUCCESS:");
    console.log("Status:", res.status);
    console.log("Data:", JSON.stringify(res.data, null, 2));
  })
  .catch((err) => {
    console.error("\n❌ SAP ERROR:");
    console.error("HTTP Status:", err.response?.status);
    console.error("Headers:", JSON.stringify(err.response?.headers, null, 2));

    const rawData = err.response?.data;
    if (typeof rawData === "string" && rawData.trim().startsWith("<")) {
      const cleaned = rawData.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      console.error("SAP HTML Error (cleaned):", cleaned.slice(0, 2000));
    } else {
      console.error("SAP Response Data:", rawData);
    }

    if (!err.response) {
      console.error("Network Error (no response):", err.message);
      console.error("Code:", err.code);
    }
  });
