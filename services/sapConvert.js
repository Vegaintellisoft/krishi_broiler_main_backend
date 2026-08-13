function convertToSAP(item) {
    const quantity = Number(item.quantity) || 0;
    const price = Number(item.base_price) || 0;
    const cgst = Number(item.cgst_rate) || 0;
    const sgst = Number(item.sgst_rate) || 0;

    const taxable = price * quantity;
    const cgstAmt = taxable * cgst / 100;
    const sgstAmt = taxable * sgst / 100;
    const gross = taxable + cgstAmt + sgstAmt;

    // Safely parse doc_date whether it's a Date object or a string
    const docDate = item.doc_date instanceof Date ? item.doc_date : new Date(item.doc_date);
    const docDateStr = docDate.toISOString().split("T")[0];

    return {
        id: item.s_no,
        BLDAT: docDateStr,
        XBLNR: item.doc_no,
        ZTO: item.to,
        ZADDRESS: item.address,
        ZTRUCK_NO: item.truck_no,
        MAKTX: item.materials,
        MATNR: item.material_code,
        ZHSN_CODE: item.hsn_code,
        MENGED: quantity.toFixed(3),
        ZRATE: (price + price * (cgst + sgst) / 100).toFixed(2),
        ZCGST_PER: cgst.toFixed(2),
        ZSGST_PER: sgst.toFixed(2),
        ZTAXABLE_VAL: taxable.toFixed(2),
        ZCGST_AMT: cgstAmt.toFixed(2),
        ZSGST_AMT: sgstAmt.toFixed(2),
        ZGROSS_AMT: gross.toFixed(2),
        ZEWAY: item.e_way_bill_no || "",
        ZSD_DISTANCE: item.distance || 0,
        ZSTATUS: item.status == 1 ? "Active" : "Cancelled",
        ZREASON: item.reason || "-",
        ZPO_NO: item.po_number,
        ZNO_OF_BAGS: item.no_of_bags,
        ZRR_NO: item.rr_no,
        ZTOKEN: item.token_no,
        ZVBELN: item.bill_number,
        ZSUPPLR: item.supplier_id,
        AEDAT: docDateStr,
        ZRR_DATE: item?.rr_date,
        ZSUPP_NAME: item.supplier_name,
        ZSUP_INV_DATE: item?.supplier_invoice_date,
        LFUHR: docDateStr,
        MEINS: item.unit_name,
        FKART: item.doc_no?.includes("T") ? "Taxable" : "Exempted",
        FKDAT: docDateStr,
        ZEWAY_STATUS: !item.e_way_bill_no
            ? "-"
            : item.status == 1
                ? "Active"
                : "Cancelled",
        ZCANC_REASON: item.reason || "-",
        ZBRANCH: item?.branch_name || "-",
        PO_DATE: item?.po_date || "-"
    };
}

module.exports = { convertToSAP };